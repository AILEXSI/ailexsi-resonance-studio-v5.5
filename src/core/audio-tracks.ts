import { createId } from "./ids";
import {
  MAX_AUDIO_TRACKS,
  MIN_AUDIO_TRACKS,
  audioTrackLabel,
  audioTracksOf,
  isTrackId,
  isVideoTrackId,
  orderedTracks,
  type AutomationLane,
  type Project,
  type Track,
  type TrackId,
} from "./models";

export { MAX_AUDIO_TRACKS, MIN_AUDIO_TRACKS };

export function createAudioTrack(index: number, id?: TrackId): Track {
  return {
    id: id && isTrackId(id) && !isVideoTrackId(id) ? id : createId("a"),
    kind: "audio",
    name: audioTrackLabel(index),
    order: 0,
    muted: false,
    solo: false,
    volume: 1,
    pan: 0,
    automationLanes: [],
  };
}

export function isDefaultAudioTrackName(name: string): boolean {
  return /^A[1-9]\d*$/.test(name);
}

export function relabelAudioTrackNames(tracks: readonly Track[]): Track[] {
  let audioIndex = 0;
  return tracks.map((track) => {
    if (track.kind !== "audio") return track;
    const name = audioTrackLabel(audioIndex);
    audioIndex += 1;
    if (!isDefaultAudioTrackName(track.name)) return track;
    return track.name === name ? track : { ...track, name };
  });
}

export function reindexTrackOrder(tracks: readonly Track[]): Track[] {
  return tracks.map((track, i) => (track.order === i ? track : { ...track, order: i }));
}

export function canAddAudioTrack(project: Pick<Project, "tracks">): boolean {
  return audioTracksOf(project).length < MAX_AUDIO_TRACKS;
}

export function canRemoveAudioTrack(
  project: Pick<Project, "tracks">,
  trackId?: TrackId,
): boolean {
  const audio = audioTracksOf(project);
  if (audio.length <= MIN_AUDIO_TRACKS) return false;
  if (!trackId) return true;
  const track = project.tracks.find((t) => t.id === trackId);
  if (track?.kind === "audio") return true;
  return audio.length > MIN_AUDIO_TRACKS;
}

export function addAudioTrack(project: Project): {
  project: Project;
  track?: Track;
  error?: string;
} {
  const audio = audioTracksOf(project);
  if (audio.length >= MAX_AUDIO_TRACKS) {
    return { project, error: `Audio track limit is ${MAX_AUDIO_TRACKS}` };
  }
  const track = createAudioTrack(audio.length);
  const ordered = orderedTracks(project);
  track.order = ordered.length;
  const tracks = reindexTrackOrder(relabelAudioTrackNames([...ordered, track]));
  return {
    project: {
      ...project,
      tracks,
      updatedAt: new Date().toISOString(),
    },
    track,
  };
}

export function removeAudioTrack(
  project: Project,
  trackId?: TrackId,
): { project: Project; removedId?: TrackId; error?: string } {
  const audio = audioTracksOf(project);
  if (audio.length <= MIN_AUDIO_TRACKS) {
    return { project, error: "Need at least two audio tracks" };
  }
  const target =
    (trackId ? audio.find((t) => t.id === trackId) : undefined) ?? audio[audio.length - 1];
  if (!target || target.kind !== "audio") {
    return { project, error: "Not an audio track" };
  }
  if (audio.length <= MIN_AUDIO_TRACKS) {
    return { project, error: "Need at least two audio tracks" };
  }
  const tracks = reindexTrackOrder(
    relabelAudioTrackNames(orderedTracks(project).filter((t) => t.id !== target.id)),
  );
  return {
    project: {
      ...project,
      tracks,
      clips: project.clips.filter((c) => c.trackId !== target.id),
      updatedAt: new Date().toISOString(),
    },
    removedId: target.id,
  };
}

export function ensureAudioTracksForIds(
  tracks: readonly Track[],
  clipTrackIds: readonly TrackId[],
): Track[] {
  const have = new Set(tracks.map((t) => t.id));
  const next = [...tracks];
  let audioCount = next.filter((t) => t.kind === "audio").length;
  for (const id of clipTrackIds) {
    if (!id || have.has(id) || isVideoTrackId(id) || id === "VIS" || !isTrackId(id)) continue;
    if (audioCount >= MAX_AUDIO_TRACKS) break;
    const extra = createAudioTrack(audioCount, id);
    extra.id = id;
    extra.order = next.length;
    next.push(extra);
    have.add(id);
    audioCount += 1;
  }
  return reindexTrackOrder(relabelAudioTrackNames(next));
}

export function sanitizeAutomationLanes(raw: unknown): AutomationLane[] {
  if (!Array.isArray(raw)) return [];
  const lanes: AutomationLane[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    const id = typeof rec.id === "string" && rec.id.length > 0 ? rec.id : createId("auto");
    const points = Array.isArray(rec.points)
      ? rec.points
          .filter((p) => p && typeof p === "object")
          .map((p) => {
            const pt = p as Record<string, unknown>;
            return {
              timeMs: Math.max(0, Number(pt.timeMs) || 0),
              value: Number.isFinite(Number(pt.value)) ? Number(pt.value) : 1,
            };
          })
      : [];
    lanes.push({ id, kind: "volume", points });
  }
  return lanes;
}
