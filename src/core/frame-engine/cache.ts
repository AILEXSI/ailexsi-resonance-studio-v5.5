import { afePerfAdd, afePerfCount, afePerfEnabled } from "./perf";
import type { AfeMemoryStats } from "./types";

const DEFAULT_MAX_DECODED = 12;

export class DecodedFrameCache {
  private readonly max: number;
  private readonly frames = new Map<number, VideoFrame>();
  private readonly lru: number[] = [];
  private peak = 0;
  private frameBytes = 0;

  constructor(maxDecoded = DEFAULT_MAX_DECODED) {
    this.max = Math.max(1, maxDecoded);
  }

  get(index: number): VideoFrame | undefined {
    const t0 = afePerfEnabled() && typeof performance !== "undefined" ? performance.now() : 0;
    afePerfCount("cacheLookups");
    const hit = this.frames.get(index);
    if (!hit) {
      afePerfCount("cacheMisses");
      if (t0) afePerfAdd("frameCacheLookup", performance.now() - t0);
      return undefined;
    }
    afePerfCount("cacheHits");
    const pos = this.lru.indexOf(index);
    if (pos >= 0) this.lru.splice(pos, 1);
    this.lru.push(index);
    if (t0) afePerfAdd("frameCacheLookup", performance.now() - t0);
    return hit;
  }

  /** Store `frame`. Evicts LRU and closes those VideoFrames. */
  put(index: number, frame: VideoFrame): void {
    const prev = this.frames.get(index);
    if (prev && prev !== frame) {
      try {
        prev.close();
      } catch {
        /* already closed */
      }
      this.frameBytes -= this.estimate(prev);
    }
    this.frames.set(index, frame);
    const pos = this.lru.indexOf(index);
    if (pos >= 0) this.lru.splice(pos, 1);
    this.lru.push(index);
    this.frameBytes += this.estimate(frame);
    this.evict();
    this.peak = Math.max(this.peak, this.frames.size);
  }

  takeClone(index: number): VideoFrame | null {
    const hit = this.get(index);
    if (!hit) return null;
    return hit.clone();
  }

  clear(): void {
    for (const frame of this.frames.values()) {
      try {
        frame.close();
      } catch {
        /* already closed */
      }
    }
    this.frames.clear();
    this.lru.length = 0;
    this.frameBytes = 0;
  }

  stats(): AfeMemoryStats {
    return {
      decodedCached: this.frames.size,
      maxDecodedCached: this.max,
      approxBytes: this.frameBytes,
      peakDecodedCached: this.peak,
    };
  }

  private estimate(frame: VideoFrame): number {
    const w = frame.codedWidth || 1;
    const h = frame.codedHeight || 1;
    return w * h * 4;
  }

  private evict(): void {
    while (this.frames.size > this.max) {
      const oldest = this.lru.shift();
      if (oldest == null) break;
      const frame = this.frames.get(oldest);
      if (!frame) continue;
      this.frames.delete(oldest);
      this.frameBytes -= this.estimate(frame);
      afePerfCount("cacheEvictions");
      try {
        frame.close();
      } catch {
        /* already closed */
      }
    }
  }
}
