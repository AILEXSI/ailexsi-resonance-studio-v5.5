import { addAudioTrack } from "./audio-tracks";
import { trackLabelFromFilename } from "./media-display";
import { audioTracksOf, type Project, type TrackId } from "./models";
import { ensureTrackGroup } from "./track-groups";

/** Playhead when the user has parked it; otherwise timeline origin. */
export function stemStartMs(playheadMs: number): number {
  if (!Number.isFinite(playheadMs) || playheadMs <= 0) return 0;
  return Math.round(playheadMs);
}

/** Shared group tag for a stem batch. F maps this into `Project.groups` when present. */
export function inferStemGroupId(fileNames: readonly string[]): string | undefined {
  const bases = fileNames
    .map((n) => (n.replace(/\\/g, "/").split("/").pop() ?? n).replace(/\.[A-Za-z0-9]{1,8}$/, ""))
    .filter((n) => n.length > 0);
  if (bases.length < 2) return undefined;
  let prefix = bases[0]!;
  for (const base of bases.slice(1)) {
    let i = 0;
    while (i < prefix.length && i < base.length && prefix[i] === base[i]) i += 1;
    prefix = prefix.slice(0, i);
  }
  prefix = prefix.replace(/[-_\s.]+$/g, "").trim();
  return prefix.length >= 2 ? prefix.slice(0, 24) : undefined;
}

export function allocateAudioTracksForStems(
  project: Project,
  count: number,
): { project: Project; trackIds: TrackId[]; skipped: number } {
  const want = Math.max(0, Math.floor(count));
  let next = project;
  const trackIds: TrackId[] = [];
  for (const track of audioTracksOf(next)) {
    if (trackIds.length >= want) break;
    const occupied = next.clips.some((c) => c.trackId === track.id);
    if (!occupied) trackIds.push(track.id);
  }
  while (trackIds.length < want) {
    const added = addAudioTrack(next);
    if (added.error || !added.track) break;
    next = added.project;
    trackIds.push(added.track.id);
  }
  return { project: next, trackIds, skipped: Math.max(0, want - trackIds.length) };
}

export function nameStemTrack(
  project: Project,
  trackId: TrackId,
  fileName: string,
  groupId?: string,
): Project {
  const name = trackLabelFromFilename(fileName);
  const next: Project = {
    ...project,
    tracks: project.tracks.map((track) => {
      if (track.id !== trackId) return track;
      return {
        ...track,
        name,
        groupId: groupId && !track.groupId ? groupId : track.groupId,
      };
    }),
    updatedAt: new Date().toISOString(),
  };
  return groupId ? ensureTrackGroup(next, groupId, groupId) : next;
}
