import { livingLinkedMate } from "./link";
import {
  clipById,
  clipIsEnabled,
  clipIsLocked,
  kindOfTrack,
  sourceDeltaToTimeline,
  type MediaKind,
  type Project,
} from "./models";

/** Living same-`linkId` mate that still shares this asset (P15 pair, no second model).
 * A disabled primary does not remap a living mate (inverse of P141 / P151). */
function clipIdsIncludingLinkedSameAsset(
  project: Project,
  clipIds: readonly string[],
): string[] {
  const ids = new Set<string>();
  for (const id of clipIds) {
    const clip = clipById(project, id);
    if (!clip) continue;
    ids.add(clip.id);
    if (!clipIsEnabled(clip)) continue;
    const mate = livingLinkedMate(project, clip.id);
    if (mate && mate.assetId === clip.assetId) ids.add(mate.id);
  }
  return [...ids];
}

export function relinkSelectionOf(
  project: Project,
  clipIds: readonly string[],
): { clipIds: string[]; assetId: string; kind: MediaKind } | null {
  const clips = clipIdsIncludingLinkedSameAsset(project, clipIds)
    .map((id) => clipById(project, id))
    .filter((c): c is NonNullable<typeof c> => !!c);
  if (clips.length === 0) return null;
  const assetId = clips[0]!.assetId;
  if (clips.some((c) => c.assetId !== assetId)) return null;
  const asset = project.assets.find((a) => a.id === assetId);
  const kind = asset?.kind ?? kindOfTrack(clips[0]!.trackId);
  return { clipIds: clips.map((c) => c.id), assetId, kind };
}

export function canShowRelink(project: Project, clipIds: readonly string[]): boolean {
  return relinkSelectionOf(project, clipIds) != null;
}

/** All clips that share this asset — bin Relink uses existing clip remapping. */
export function relinkSelectionForAsset(
  project: Project,
  assetId: string,
): { clipIds: string[]; assetId: string; kind: MediaKind } | null {
  const asset = project.assets.find((a) => a.id === assetId);
  if (!asset) return null;
  const clipIds = project.clips.filter((c) => c.assetId === assetId).map((c) => c.id);
  if (clipIds.length === 0) return null;
  return relinkSelectionOf(project, clipIds);
}

export function relinkClipsOnProject(
  project: Project,
  clipIds: readonly string[],
  newAssetId: string,
): { project: Project } | { error: string } | { unchanged: true } {
  const sel = relinkSelectionOf(project, clipIds);
  if (!sel) return { unchanged: true };
  const asset = project.assets.find((a) => a.id === newAssetId);
  if (!asset) return { error: "Relink failed: replacement asset is missing" };
  if (asset.kind !== sel.kind) {
    return { error: `Relink rejected: expected ${sel.kind}, got ${asset.kind}` };
  }
  let changed = false;
  let lockedShrink = false;
  let emptied = false;
  const clips = project.clips.map((clip) => {
    if (!sel.clipIds.includes(clip.id)) return clip;
    const wouldShrink = asset.durationMs < clip.sourceOutMs;
    // Lock is relocate-only: remapping assetId is recovery, shrinking
    // duration/sourceOut is not. Skip a locked clip that would shrink
    // (same as skip-locked-mate). Unlocked clips in the selection still relink.
    if (clipIsLocked(clip) && wouldShrink) {
      lockedShrink = true;
      return clip;
    }
    let next = { ...clip, assetId: newAssetId };
    if (wouldShrink) {
      const sourceOutMs = asset.durationMs;
      const sourceSpan = sourceOutMs - clip.sourceInMs;
      // Trimmed IN past the new file would write duration 0 (ghost clip).
      if (sourceSpan < 1) {
        emptied = true;
        return clip;
      }
      const durationMs = Math.max(1, sourceDeltaToTimeline(clip, sourceSpan));
      next = { ...next, sourceOutMs, durationMs };
    }
    if (
      next.assetId !== clip.assetId ||
      next.sourceOutMs !== clip.sourceOutMs ||
      next.durationMs !== clip.durationMs
    ) {
      changed = true;
    }
    return next;
  });
  if (!changed) {
    if (lockedShrink) return { error: "Clip is locked" };
    if (emptied) return { error: "Relink would empty the clip" };
    return { unchanged: true };
  }
  return {
    project: {
      ...project,
      clips,
      updatedAt: new Date().toISOString(),
    },
  };
}
