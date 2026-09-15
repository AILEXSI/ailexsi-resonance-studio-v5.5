import { normalizeClipFades } from "./fades";

/** Matches `.trim-handle` width. Trim wins this strip at each clip edge. */
export const TRIM_HANDLE_PX = 8;
/** Fade hit target, inset from the trim edge. */
export const FADE_HANDLE_PX = 10;
/** Below this clip width, hide fade handles and keep trim edges. */
export const FADE_HANDLE_MIN_CLIP_PX = 48;

export type ClipHitZone = "trim-in" | "trim-out" | "fade-in" | "fade-out" | "body";

export function fadeHandlesVisible(clipWidthPx: number): boolean {
  return clipWidthPx >= FADE_HANDLE_MIN_CLIP_PX;
}

/**
 * Hit test in clip-local CSS pixels. Trim edges are always [0, 8) and
 * [width−8, width]. Fade targets sit just inside those strips when the
 * clip is wide enough. Alt-slip / Ctrl+Alt-slide / body-move use "body".
 */
export function clipHitZone(localX: number, clipWidthPx: number): ClipHitZone {
  const w = Math.max(0, clipWidthPx);
  const x = localX;
  if (x <= TRIM_HANDLE_PX) return "trim-in";
  if (x >= w - TRIM_HANDLE_PX) return "trim-out";
  if (!fadeHandlesVisible(w)) return "body";
  if (x < TRIM_HANDLE_PX + FADE_HANDLE_PX) return "fade-in";
  if (x > w - TRIM_HANDLE_PX - FADE_HANDLE_PX) return "fade-out";
  return "body";
}

/** Pixel drag → fade ms. Fade-in grows to the right; fade-out grows to the left. */
export function fadeMsFromDrag(
  originFadeMs: number,
  deltaPx: number,
  zoomPxPerSec: number,
  edge: "in" | "out",
): number {
  const zoom = zoomPxPerSec > 0 ? zoomPxPerSec : 1;
  const deltaMs = (deltaPx / zoom) * 1000;
  return edge === "in" ? originFadeMs + deltaMs : originFadeMs - deltaMs;
}

export function fadesFromHandleDrag(
  originInMs: number,
  originOutMs: number,
  durationMs: number,
  deltaPx: number,
  zoomPxPerSec: number,
  edge: "in" | "out",
): { fadeInMs: number; fadeOutMs: number } {
  const fadeInMs = edge === "in" ? fadeMsFromDrag(originInMs, deltaPx, zoomPxPerSec, "in") : originInMs;
  const fadeOutMs = edge === "out" ? fadeMsFromDrag(originOutMs, deltaPx, zoomPxPerSec, "out") : originOutMs;
  return normalizeClipFades(fadeInMs, fadeOutMs, durationMs);
}
