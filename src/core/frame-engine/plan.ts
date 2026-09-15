import { decodeOrigin, keyframeAtOrBefore, sampleIndexAtTime } from "./mp4-reader";
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
  const decodeStart = decodeOrigin(movie, lo);
  const needed = new Uint8Array(hi - decodeStart + 1);
  for (let i = start; i < end; i++) {
    const idx = indexes[i];
    if (idx != null) needed[idx - decodeStart] = 1;
  }
  return { decodeStart, decodeEnd: hi, needed };
}

/** True when times map to a single non-decreasing sample-index run (constant-CTTS fast path). */
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

/**
 * True seek-back across a prior GOP. B-frame presentation order wobbles
 * decode indexes inside the same GOP — that is not a seek.
 */
export function shouldSplitPresentationRun(
  movie: AfeMovie,
  prevMaxDecode: number,
  nextIndex: number,
): boolean {
  if (nextIndex >= prevMaxDecode) return false;
  return keyframeAtOrBefore(movie, nextIndex) < keyframeAtOrBefore(movie, prevMaxDecode);
}

/** Sequential export with B-frames: decode indexes may decrease inside a GOP. */
export function isPresentationRun(
  movie: AfeMovie,
  indexes: readonly (number | null)[],
  start: number,
  end: number,
): boolean {
  let maxIdx = -1;
  let seen = false;
  for (let i = start; i < end; i++) {
    const idx = indexes[i];
    if (idx == null) return false;
    if (seen && shouldSplitPresentationRun(movie, maxIdx, idx)) return false;
    maxIdx = seen ? Math.max(maxIdx, idx) : idx;
    seen = true;
  }
  return seen;
}

export function maxDecodeIndex(indexes: readonly (number | null)[], start: number, end: number): number {
  let hi = -1;
  for (let i = start; i < end; i++) {
    const idx = indexes[i];
    if (idx != null && idx > hi) hi = idx;
  }
  return hi;
}
