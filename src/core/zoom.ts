import { projectDurationMs, type Project } from "./models";

/** Default lane label / ruler gutter width. Live width lives in layout-prefs. */
export const LANE_LABEL_PX = 96;

/** Inset of t=0 from the lane-body / ruler-body left edge. */
export const RULER_PAD_PX = 56;

/** ~1 CSS pixel per sample at 48 kHz. The old 400 px/s cap was an MVP wall. */
export const ZOOM_MAX_PX_PER_SEC = 48_000;

/** Floor when the project already fits at 1 px/s. Longer projects may go lower. */
export const ZOOM_ABS_MIN_PX_PER_SEC = 1;

export function usableLanePx(timelineWidthPx: number, laneLabelPx = LANE_LABEL_PX): number {
  const label = laneLabelPx > 0 ? laneLabelPx : LANE_LABEL_PX;
  return Math.max(1, timelineWidthPx - label - RULER_PAD_PX);
}

export function fitDurationMs(project: Project): number {
  return Math.max(projectDurationMs(project), 1000);
}

/** Zoom that places the whole project in the visible lane body. */
export function fitZoomPxPerSec(
  project: Project,
  timelineWidthPx: number,
  laneLabelPx = LANE_LABEL_PX,
): number {
  return usableLanePx(timelineWidthPx, laneLabelPx) / (fitDurationMs(project) / 1000);
}

/** Most-zoomed-out value: 1 px/s, or lower if a long clip still cannot fit. */
export function minZoomPxPerSec(
  project: Project,
  timelineWidthPx: number,
  laneLabelPx = LANE_LABEL_PX,
): number {
  return Math.min(ZOOM_ABS_MIN_PX_PER_SEC, fitZoomPxPerSec(project, timelineWidthPx, laneLabelPx));
}

export function clampZoomPxPerSec(zoom: number, minZoom: number): number {
  return Math.max(minZoom, Math.min(ZOOM_MAX_PX_PER_SEC, zoom));
}

export function visibleDurationMs(
  zoomPxPerSec: number,
  timelineWidthPx: number,
  laneLabelPx = LANE_LABEL_PX,
): number {
  return (usableLanePx(timelineWidthPx, laneLabelPx) / Math.max(zoomPxPerSec, 1e-6)) * 1000;
}

/** Furthest left-edge time so the project end can sit on the right of the lane. */
export function maxScrollMs(
  durationMs: number,
  zoomPxPerSec: number,
  timelineWidthPx: number,
  laneLabelPx = LANE_LABEL_PX,
): number {
  return Math.max(0, durationMs - visibleDurationMs(zoomPxPerSec, timelineWidthPx, laneLabelPx));
}

export function clampScrollMs(
  scrollMs: number,
  durationMs: number,
  zoomPxPerSec: number,
  timelineWidthPx: number,
  laneLabelPx = LANE_LABEL_PX,
): number {
  const max = maxScrollMs(durationMs, zoomPxPerSec, timelineWidthPx, laneLabelPx);
  return Math.max(0, Math.min(scrollMs, max));
}

/** Playhead is in the time span drawn after the ruler pad. */
export function playheadInView(
  playheadMs: number,
  scrollMs: number,
  zoomPxPerSec: number,
  timelineWidthPx: number,
  laneLabelPx = LANE_LABEL_PX,
): boolean {
  const viewEnd = scrollMs + visibleDurationMs(zoomPxPerSec, timelineWidthPx, laneLabelPx);
  return playheadMs >= scrollMs && playheadMs <= viewEnd;
}

/** Viewport fraction where Follow pins the playhead during transport. */
export const FOLLOW_ANCHOR_RATIO = 0.65;

/** Playhead position as a 0..1 fraction of the visible lane (may be outside). */
export function playheadViewRatio(
  playheadMs: number,
  scrollMs: number,
  zoomPxPerSec: number,
  timelineWidthPx: number,
  laneLabelPx = LANE_LABEL_PX,
): number {
  const visible = visibleDurationMs(zoomPxPerSec, timelineWidthPx, laneLabelPx);
  return (playheadMs - scrollMs) / Math.max(visible, 1e-6);
}

/**
 * Follow during transport: walk through the left of the view, then keep the
 * playhead visually anchored at FOLLOW_ANCHOR_RATIO and scroll the shared
 * timeline underneath. One scrollMs — every lane uses the same time axis.
 * Near the project end, clamp so the playhead can finish the last 35%.
 */
export function scrollFollowPlayhead(
  playheadMs: number,
  scrollMs: number,
  zoomPxPerSec: number,
  timelineWidthPx: number,
  durationMs: number,
  laneLabelPx = LANE_LABEL_PX,
): number {
  const visible = visibleDurationMs(zoomPxPerSec, timelineWidthPx, laneLabelPx);
  const anchorOffsetMs = visible * FOLLOW_ANCHOR_RATIO;
  let next = Math.max(0, scrollMs);
  if (playheadMs < next) {
    next = Math.max(0, playheadMs);
  } else if (playheadMs > next + anchorOffsetMs) {
    next = playheadMs - anchorOffsetMs;
  }
  return clampScrollMs(next, durationMs, zoomPxPerSec, timelineWidthPx, laneLabelPx);
}

function centerPlayheadScrollMs(
  playheadMs: number,
  zoomPxPerSec: number,
  timelineWidthPx: number,
  laneLabelPx = LANE_LABEL_PX,
): number {
  const half = visibleDurationMs(zoomPxPerSec, timelineWidthPx, laneLabelPx) / 2;
  return Math.max(0, playheadMs - half);
}

/** Page the Arrange view so the playhead stays in the visible lane. */
export function scrollKeepPlayheadInView(
  playheadMs: number,
  scrollMs: number,
  zoomPxPerSec: number,
  timelineWidthPx: number,
  laneLabelPx = LANE_LABEL_PX,
): number {
  const visible = visibleDurationMs(zoomPxPerSec, timelineWidthPx, laneLabelPx);
  let scroll = Math.max(0, scrollMs);
  if (playheadMs < scroll) scroll = Math.max(0, playheadMs);
  if (playheadMs > scroll + visible) scroll = Math.max(0, playheadMs - visible);
  return scroll;
}

/**
 * DAW-style zoom around the playhead: keep it at the same screen-x.
 * If it is off-screen first, center it, then zoom around that position.
 */
export function scrollZoomAroundPlayhead(opts: {
  playheadMs: number;
  scrollMs: number;
  zoomOld: number;
  zoomNew: number;
  timelineWidthPx: number;
  laneLabelPx?: number;
}): number {
  const { playheadMs, zoomNew, timelineWidthPx } = opts;
  const laneLabelPx = opts.laneLabelPx ?? LANE_LABEL_PX;
  const zoomOld = Math.max(opts.zoomOld, 1e-6);
  let scroll = opts.scrollMs;
  if (!playheadInView(playheadMs, scroll, zoomOld, timelineWidthPx, laneLabelPx)) {
    scroll = centerPlayheadScrollMs(playheadMs, zoomOld, timelineWidthPx, laneLabelPx);
  }
  const next = playheadMs - (playheadMs - scroll) * (zoomOld / Math.max(zoomNew, 1e-6));
  return scrollKeepPlayheadInView(playheadMs, next, zoomNew, timelineWidthPx, laneLabelPx);
}
