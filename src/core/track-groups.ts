import { createId } from "./ids";
import {
  audioTracksOf,
  kindOfTrack,
  orderedTracks,
  trackById,
  type Project,
  type TrackGroup,
  type TrackId,
} from "./models";

export const TRACK_GROUP_NAME_MAX = 80;
export const TRACK_GROUP_ID_MAX = 64;

export type ArrangeRow =
  | { kind: "group"; group: TrackGroup; memberIds: TrackId[]; collapsed: boolean }
  | { kind: "track"; trackId: TrackId };

export function sanitizeTrackGroupName(raw: unknown, fallback = "Group"): string {
  const text = typeof raw === "string" ? raw.trim() : "";
  if (!text) return fallback;
  return text.slice(0, TRACK_GROUP_NAME_MAX);
}

export function sanitizeTrackGroupId(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  const id = raw.trim().slice(0, TRACK_GROUP_ID_MAX);
  return id.length > 0 ? id : undefined;
}

export function sanitizeTrackGroups(raw: unknown): TrackGroup[] {
  if (!Array.isArray(raw)) return [];
  const out: TrackGroup[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    const id = sanitizeTrackGroupId(rec.id);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push({ id, name: sanitizeTrackGroupName(rec.name, id) });
  }
  return out;
}

/** Groups listed on the project, plus any `Track.groupId` that is not listed yet. */
export function groupsOf(project: Pick<Project, "tracks" | "groups">): TrackGroup[] {
  const listed = sanitizeTrackGroups(project.groups);
  const have = new Set(listed.map((g) => g.id));
  const extra: TrackGroup[] = [];
  for (const track of project.tracks) {
    const id = sanitizeTrackGroupId(track.groupId);
    if (!id || have.has(id)) continue;
    have.add(id);
    extra.push({ id, name: id });
  }
  return extra.length === 0 ? listed : [...listed, ...extra];
}

export function groupById(
  project: Pick<Project, "tracks" | "groups">,
  groupId: string,
): TrackGroup | undefined {
  return groupsOf(project).find((g) => g.id === groupId);
}

export function tracksInGroup(
  project: Pick<Project, "tracks">,
  groupId: string,
): TrackId[] {
  return audioTracksOf(project)
    .filter((t) => t.groupId === groupId)
    .map((t) => t.id);
}

export function pruneEmptyTrackGroups(project: Project): Project {
  const used = new Set(
    project.tracks.map((t) => sanitizeTrackGroupId(t.groupId)).filter((id): id is string => Boolean(id)),
  );
  const groups = groupsOf(project).filter((g) => used.has(g.id));
  const prev = project.groups ?? [];
  if (groups.length === prev.length && groups.every((g, i) => g.id === prev[i]?.id && g.name === prev[i]?.name)) {
    return project.groups ? project : { ...project, groups };
  }
  return { ...project, groups, updatedAt: new Date().toISOString() };
}

/** Persist listed groups and invent rows for stem-import `groupId`s that have members. */
export function syncTrackGroups(project: Project): Project {
  const groups = groupsOf(project);
  const used = new Set(
    project.tracks.map((t) => sanitizeTrackGroupId(t.groupId)).filter((id): id is string => Boolean(id)),
  );
  const next = groups.filter((g) => used.has(g.id));
  const prev = project.groups ?? [];
  if (next.length === prev.length && next.every((g, i) => g.id === prev[i]?.id && g.name === prev[i]?.name)) {
    return project.groups ? project : { ...project, groups: next };
  }
  return { ...project, groups: next };
}

export function ensureTrackGroup(project: Project, groupId: string, name?: string): Project {
  const id = sanitizeTrackGroupId(groupId);
  if (!id) return project;
  let next = groupsOf(project);
  if (!next.some((g) => g.id === id)) {
    next = [...next, { id, name: sanitizeTrackGroupName(name, id) }];
  } else if (name) {
    next = next.map((g) => (g.id === id && g.name === id ? { ...g, name: sanitizeTrackGroupName(name, id) } : g));
  }
  const prev = project.groups ?? [];
  if (next.length === prev.length && next.every((g, i) => g.id === prev[i]?.id && g.name === prev[i]?.name)) {
    return project.groups ? project : { ...project, groups: next };
  }
  return { ...project, groups: next, updatedAt: new Date().toISOString() };
}

export function nextTrackGroupName(project: Pick<Project, "tracks" | "groups">): string {
  return `Chapter ${groupsOf(project).length + 1}`;
}

export function createTrackGroup(
  project: Project,
  opts: { name?: string; trackIds?: readonly TrackId[]; id?: string } = {},
): { project: Project; group?: TrackGroup; error?: string } {
  const id = sanitizeTrackGroupId(opts.id) ?? createId("g");
  if (groupsOf(project).some((g) => g.id === id)) {
    return { project, error: "Group already exists" };
  }
  const group: TrackGroup = {
    id,
    name: sanitizeTrackGroupName(opts.name, nextTrackGroupName(project)),
  };
  let next: Project = {
    ...project,
    groups: [...groupsOf(project), group],
    updatedAt: new Date().toISOString(),
  };
  if (opts.trackIds && opts.trackIds.length > 0) {
    next = assignTracksToGroup(next, opts.trackIds, id);
  }
  return { project: next, group };
}

export function renameTrackGroup(project: Project, groupId: string, name: string): Project {
  const id = sanitizeTrackGroupId(groupId);
  if (!id) return project;
  const groups = groupsOf(project);
  const idx = groups.findIndex((g) => g.id === id);
  if (idx < 0) return project;
  const nextName = sanitizeTrackGroupName(name, groups[idx]!.name);
  if (nextName === groups[idx]!.name) return project;
  const next = groups.map((g, i) => (i === idx ? { ...g, name: nextName } : g));
  return { ...project, groups: next, updatedAt: new Date().toISOString() };
}

export function assignTracksToGroup(
  project: Project,
  trackIds: readonly TrackId[],
  groupId: string | null,
): Project {
  const ids = new Set(trackIds);
  if (ids.size === 0) return project;
  const target = groupId == null ? undefined : sanitizeTrackGroupId(groupId);
  let next: Project = target ? ensureTrackGroup(project, target) : project;
  let changed = next !== project;
  const tracks = next.tracks.map((track) => {
    if (!ids.has(track.id) || track.kind !== "audio") return track;
    if ((track.groupId ?? undefined) === target) return track;
    changed = true;
    return target ? { ...track, groupId: target } : { ...track, groupId: undefined };
  });
  if (!changed) return pruneEmptyTrackGroups(next);
  next = { ...next, tracks, updatedAt: new Date().toISOString() };
  return pruneEmptyTrackGroups(next);
}

/**
 * Timeline + Mixer row list. Collapse hides child audio lanes/channels only.
 * Video tracks never join a group. Track `order` is unchanged.
 */
export function arrangeRows(
  project: Pick<Project, "tracks" | "groups">,
  opts: { visibleTrackIds?: readonly TrackId[]; collapsedGroupIds?: Iterable<string> } = {},
): ArrangeRow[] {
  const collapsed = new Set(
    [...(opts.collapsedGroupIds ?? [])].map((id) => sanitizeTrackGroupId(id)).filter((id): id is string => Boolean(id)),
  );
  const visible = opts.visibleTrackIds ?? orderedTracks(project).map((t) => t.id);
  const listed = groupsOf(project);
  const seen = new Set<string>();
  const rows: ArrangeRow[] = [];
  for (const id of visible) {
    const track = trackById(project, id);
    if (!track) continue;
    const gid = track.kind === "audio" ? sanitizeTrackGroupId(track.groupId) : undefined;
    if (gid) {
      if (!seen.has(gid)) {
        seen.add(gid);
        const group = listed.find((g) => g.id === gid) ?? { id: gid, name: gid };
        const memberIds = visible.filter((vid) => {
          const member = trackById(project, vid);
          return member?.kind === "audio" && member.groupId === gid;
        });
        rows.push({ kind: "group", group, memberIds, collapsed: collapsed.has(gid) });
      }
      if (!collapsed.has(gid)) rows.push({ kind: "track", trackId: id });
      continue;
    }
    rows.push({ kind: "track", trackId: id });
  }
  return rows;
}

export function visibleTrackIdsForGroups(
  project: Pick<Project, "tracks" | "groups">,
  visibleTrackIds: readonly TrackId[] | undefined,
  collapsedGroupIds: Iterable<string>,
): TrackId[] {
  return arrangeRows(project, { visibleTrackIds, collapsedGroupIds })
    .filter((row): row is Extract<ArrangeRow, { kind: "track" }> => row.kind === "track")
    .map((row) => row.trackId);
}

/**
 * Where last-lane +/− (and Grp) should sit: last audio lane if visible,
 * else the collapsed group that still owns the last audio track.
 */
export function lastAudioChromeHost(
  project: Pick<Project, "tracks" | "groups">,
  rows: readonly ArrangeRow[],
): { kind: "track"; trackId: TrackId } | { kind: "group"; groupId: string } | undefined {
  const lastAudio = audioTracksOf(project).at(-1);
  if (!lastAudio) return undefined;
  if (rows.some((row) => row.kind === "track" && row.trackId === lastAudio.id)) {
    return { kind: "track", trackId: lastAudio.id };
  }
  const host = rows.find((row) => row.kind === "group" && row.memberIds.includes(lastAudio.id));
  if (host && host.kind === "group") return { kind: "group", groupId: host.group.id };
  const lastVisible = [...rows].reverse().find((row) => {
    if (row.kind !== "track") return false;
    return kindOfTrack(row.trackId) === "audio";
  });
  return lastVisible && lastVisible.kind === "track" ? { kind: "track", trackId: lastVisible.trackId } : undefined;
}
