import { AfeError } from "./errors";

/**
 * PTS-keyed sample identity for decoded VideoFrames.
 *
 * Submit encoded samples in DTS / decode order. Tag each chunk with PTS(us).
 * When VideoDecoder outputs a frame, take the exact timestamp — FIFO is not
 * an identity (B-frames reorder). Duplicate PTS values use a stable queue of
 * sample indexes in submit order. No nearest / snap / ±1 heuristic.
 */

export const AFE_MAX_REORDER_READY = 64;

export class PtsIndexMap {
  private readonly queues = new Map<number, number[]>();
  private pending = 0;

  push(timestampUs: number, sampleIndex: number): void {
    let q = this.queues.get(timestampUs);
    if (!q) {
      q = [];
      this.queues.set(timestampUs, q);
    }
    q.push(sampleIndex);
    this.pending += 1;
  }

  /** Exact PTS match only. Undefined = fail closed (do not guess). */
  takeExact(timestampUs: number): number | undefined {
    const q = this.queues.get(timestampUs);
    if (!q || q.length === 0) return undefined;
    const index = q.shift()!;
    this.pending -= 1;
    if (q.length === 0) this.queues.delete(timestampUs);
    return index;
  }

  hasIndex(sampleIndex: number): boolean {
    for (const q of this.queues.values()) {
      if (q.includes(sampleIndex)) return true;
    }
    return false;
  }

  deleteIndex(sampleIndex: number): boolean {
    for (const [ts, q] of this.queues) {
      const pos = q.indexOf(sampleIndex);
      if (pos < 0) continue;
      q.splice(pos, 1);
      this.pending -= 1;
      if (q.length === 0) this.queues.delete(ts);
      return true;
    }
    return false;
  }

  pendingCount(): number {
    return this.pending;
  }

  clear(): void {
    this.queues.clear();
    this.pending = 0;
  }
}

export type CttsKind = "absent" | "constant" | "variable";

export function classifyCtts(offsets: number[] | null): CttsKind {
  if (!offsets || offsets.length === 0) return "absent";
  const first = offsets[0]!;
  for (let i = 1; i < offsets.length; i++) {
    if (offsets[i] !== first) return "variable";
  }
  return "constant";
}

/** Samples that decode later but present earlier — H.264 reorder delay in sample counts. */
export function maxReorderSamples(
  samples: readonly { index: number; ptsTimescale: number }[],
): number {
  if (samples.length === 0) return 0;
  const present = samples
    .map((s, decodeIndex) => ({ decodeIndex, pts: s.ptsTimescale, index: s.index }))
    .sort((a, b) => (a.pts !== b.pts ? a.pts - b.pts : a.index - b.index));
  let max = 0;
  for (let p = 0; p < present.length; p++) {
    const delay = present[p]!.decodeIndex - p;
    if (delay > max) max = delay;
  }
  return max;
}

export function addTimescale(a: number, b: number, label: string): number {
  if (!Number.isSafeInteger(a) || !Number.isSafeInteger(b)) {
    throw new AfeError("AFE_UNSUPPORTED_SAMPLE_TABLE", `${label} is not a safe integer`);
  }
  const sum = a + b;
  if (!Number.isSafeInteger(sum)) {
    throw new AfeError("AFE_UNSUPPORTED_SAMPLE_TABLE", `${label} overflow`);
  }
  return sum;
}
