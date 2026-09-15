import { keyframeAtOrBefore, sampleIndexAtTime } from "./mp4-reader";
import type { AfeMovie } from "./types";

/** One lookup per timestamp. Used by sequential getFramesAt so the hot loop does not search. */
export function planSampleIndexes(movie: AfeMovie, timesSec: readonly number[]): (number | null)[] {
  const indexes = new Array<number | null>(timesSec.length);
  for (let i = 0; i < timesSec.length; i++) {
    indexes[i] = sampleIndexAtTime(movie, timesSec[i]!);
  }
  return indexes;
}

export type AfeDecodeSpan = {
  /** Inclusive decode-order start (nearest prior keyframe). */
  decodeStart: number;
  /** Inclusive decode-order end (last requested sample). */
  decodeEnd: number;
  /** needed[i] is 1 when sample (decodeStart + i) is requested at least once. */
  needed: Uint8Array;
};

/**
 * Contiguous decode span + bounded membership map for one monotonic run.
 * Size is the GOP-prefix + requested span, not the whole file.
 */
export function planDecodeSpan(
  movie: AfeMovie,
  indexes: readonly (number | null)[],
  start: number,
  end: number,
): AfeDecodeSpan | null {
  let lo = Infinity;
  let hi = -1;
  for (let i = start; i < end; i++) {
    const idx = indexes[i];
    if (idx == null) continue;
    if (idx < lo) lo = idx;
    if (idx > hi) hi = idx;
  }
  if (hi < 0 || lo === Infinity) return null;
  const decodeStart = keyframeAtOrBefore(movie, lo);
  const needed = new Uint8Array(hi - decodeStart + 1);
  for (let i = start; i < end; i++) {
    const idx = indexes[i];
    if (idx != null) needed[idx - decodeStart] = 1;
  }
  return { decodeStart, decodeEnd: hi, needed };
}

/** True when times map to a single non-decreasing sample-index run (export sequential path). */
export function isMonotonicRun(indexes: readonly (number | null)[], start: number, end: number): boolean {
  let last = -1;
  let seen = false;
  for (let i = start; i < end; i++) {
    const idx = indexes[i];
    if (idx == null) return false;
    if (seen && idx < last) return false;
    last = idx;
    seen = true;
  }
  return seen;
}
