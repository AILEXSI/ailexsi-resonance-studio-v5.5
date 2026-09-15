import { TRACK_IDS, clipEndMs, isTrackId, trackIdsOf, type Clip, type Project, type TrackId } from "./models";

export const DEFAULT_MARQUEE_LANES = ["VIS", "V1", "V2", "A1", "A2"] as const;
/** @deprecated Use marqueeLanesOf(project). Default empty-project order. */
export const MARQUEE_LANES: readonly string[] = DEFAULT_MARQUEE_LANES;
export type MarqueeLane = string;

/** Below this pixel travel, pointer-up is an empty click (clears selection). */
export const MARQUEE_CLICK_SLOP_PX = 3;

export function marqueeLanesOf(project?: Pick<Project, "tracks">): string[] {
  return ["VIS", ...(project ? trackIdsOf(project) : TRACK_IDS)];
}

export function isMarqueeLane(value: string | null | undefined): value is MarqueeLane {
  return Boolean(value && (value === "VIS" || isTrackId(value)));
}

export function tracksInLaneSpan(
  a: MarqueeLane,
  b: MarqueeLane,
  lanes: readonly string[] = DEFAULT_MARQUEE_LANES,
): TrackId[] {
  const i = lanes.indexOf(a);
  const j = lanes.indexOf(b);
  if (i < 0 || j < 0) return [];
  const lo = Math.min(i, j);
  const hi = Math.max(i, j);
  return lanes.slice(lo, hi + 1).filter((id): id is TrackId => isTrackId(id));
}

export interface MarqueeRect {
  aMs: number;
  bMs: number;
  aLane: MarqueeLane;
  bLane: MarqueeLane;
}

export function clipIntersectsMarquee(
  clip: Clip,
  rect: MarqueeRect,
  lanes: readonly string[] = DEFAULT_MARQUEE_LANES,
): boolean {
  const tracks = tracksInLaneSpan(rect.aLane, rect.bLane, lanes);
  if (!tracks.includes(clip.trackId)) return false;
  const start = Math.min(rect.aMs, rect.bMs);
  const end = Math.max(rect.aMs, rect.bMs);
  const clipEnd = clipEndMs(clip);
  if (end > start) return clip.startMs < end && clipEnd > start;
  return clip.startMs <= start && clipEnd > start;
}

export function clipsIntersectingMarquee(
  clips: readonly Clip[],
  rect: MarqueeRect,
  lanes: readonly string[] = DEFAULT_MARQUEE_LANES,
): Clip[] {
  return clips
    .filter((c) => clipIntersectsMarquee(c, rect, lanes))
    .sort((a, b) => {
      const track = lanes.indexOf(a.trackId) - lanes.indexOf(b.trackId);
      return track !== 0 ? track : a.startMs - b.startMs;
    });
}
