import { FRAME_MS } from "./models";

/** Extra space between two label boxes. */
export const RULER_LABEL_GAP_PX = 8;

const NICE_STEPS_MS = [
  1,
  2,
  5,
  10,
  20,
  25,
  50,
  FRAME_MS,
  2 * FRAME_MS,
  5 * FRAME_MS,
  100,
  200,
  500,
  1_000,
  2_000,
  5_000,
  10_000,
  15_000,
  30_000,
  60_000,
  120_000,
  300_000,
  600_000,
];

export interface RulerTick {
  timeMs: number;
  kind: "major" | "minor";
  label: string | null;
}

export function estimateLabelWidthPx(label: string): number {
  return Math.ceil(label.length * 6.2 + 10);
}

export function formatRulerLabel(timeMs: number, stepMs: number): string {
  const t = Math.max(0, timeMs);
  if (stepMs >= 60_000) {
    const m = Math.floor(t / 60_000);
    const s = Math.floor((t % 60_000) / 1000);
    return `${m}:${String(s).padStart(2, "0")}`;
  }
  if (stepMs >= 1000) return `${Math.round(t / 1000)}s`;
  if (stepMs >= FRAME_MS * 0.9) {
    const frames = Math.round(t / FRAME_MS);
    return `${frames}f`;
  }
  return `${Math.round(t)}ms`;
}

export function pickRulerStepMs(zoomPxPerSec: number, minBoxPx: number): number {
  const pxPerMs = zoomPxPerSec / 1000;
  const needMs = minBoxPx / Math.max(pxPerMs, 1e-9);
  for (const step of NICE_STEPS_MS) {
    if (step + 1e-6 >= needMs) return step;
  }
  return NICE_STEPS_MS[NICE_STEPS_MS.length - 1]!;
}

export function pickMinorStepMs(majorMs: number, zoomPxPerSec: number): number | null {
  const candidates = [majorMs / 10, majorMs / 5, majorMs / 4, majorMs / 2];
  for (const step of candidates) {
    if (step < 1) continue;
    if ((step / 1000) * zoomPxPerSec >= 8) return step;
  }
  return null;
}

/**
 * Adaptive major/minor ticks. Major labels never overlap:
 * each label box is estimated and the next major is skipped if it would collide.
 */
export function buildRulerTicks(opts: {
  zoomPxPerSec: number;
  durationMs: number;
  scrollMs: number;
  viewWidthPx: number;
  minLabelGapPx?: number;
}): RulerTick[] {
  const zoom = Math.max(opts.zoomPxPerSec, 0.05);
  const gap = opts.minLabelGapPx ?? RULER_LABEL_GAP_PX;
  const probe = formatRulerLabel(0, pickRulerStepMs(zoom, 40));
  const minBox = estimateLabelWidthPx(probe) + gap;
  const majorMs = pickRulerStepMs(zoom, minBox);
  const minorMs = pickMinorStepMs(majorMs, zoom);

  const viewStart = Math.max(0, opts.scrollMs);
  const viewEnd = opts.scrollMs + (Math.max(1, opts.viewWidthPx) / zoom) * 1000;
  const from = Math.max(0, Math.floor(viewStart / majorMs) * majorMs);
  const to = Math.min(opts.durationMs + majorMs, viewEnd + majorMs);

  const majors: RulerTick[] = [];
  let lastRight = -Infinity;
  for (let t = from; t <= to + 1e-6; t += majorMs) {
    const timeMs = Math.round(t);
    const label = formatRulerLabel(timeMs, majorMs);
    const x = ((timeMs - opts.scrollMs) / 1000) * zoom;
    const width = estimateLabelWidthPx(label);
    if (x < lastRight + gap && majors.length > 0) continue;
    majors.push({ timeMs, kind: "major", label });
    lastRight = x + width;
  }

  if (!minorMs) return majors;

  const seen = new Set(majors.map((m) => m.timeMs));
  const minors: RulerTick[] = [];
  const minorFrom = Math.max(0, Math.floor(viewStart / minorMs) * minorMs);
  for (let t = minorFrom; t <= to + 1e-6; t += minorMs) {
    const timeMs = Math.round(t);
    if (seen.has(timeMs)) continue;
    minors.push({ timeMs, kind: "minor", label: null });
  }
  return [...majors, ...minors].sort((a, b) => a.timeMs - b.timeMs);
}

export function labeledTickGapPx(
  a: RulerTick,
  b: RulerTick,
  zoomPxPerSec: number,
): number {
  return Math.abs(b.timeMs - a.timeMs) * (zoomPxPerSec / 1000);
}
