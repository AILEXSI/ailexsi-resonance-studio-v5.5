import { DecodedFrameCache } from "./cache";
import { AfeVideoDecoder } from "./decoder";
import { AfeError, isAfeError, throwIfAborted } from "./errors";
import { keyframeAtOrBefore, sampleIndexAtTime } from "./mp4-reader";
import { afePerfAdd, afePerfCount, afePerfEnabled, afePerfMax } from "./perf";
import { isMonotonicRun, isPresentationRun, maxDecodeIndex, planDecodeSpan, planSampleIndexes, shouldSplitPresentationRun } from "./plan";
import type { AfeMemoryStats, AfeMovie, AfeSample, DrawableFrame } from "./types";

/** Encoded samples submitted ahead of the next yield so encode can overlap decode.
 * AFE-02 kept 8 (16 slower). After the stream/ready-queue path, 4 measured
 * faster than 2/8 on 720p30 full export; 6 was close but noisier. */
let PREFETCH = 4;

export function getAfeSequentialPrefetch(): number {
  return PREFETCH;
}

/** Harness / measurement only. Production callers leave the default. */
export function setAfeSequentialPrefetch(n: number): void {
  PREFETCH = Math.max(1, Math.min(32, n | 0));
}

export class AfeDrawable implements DrawableFrame {
  constructor(
    private readonly frame: VideoFrame,
    readonly timestamp: number,
    readonly duration: number,
  ) {}

  get codedWidth(): number {
    return this.frame.codedWidth;
  }

  get codedHeight(): number {
    return this.frame.codedHeight;
  }

  draw(ctx: CanvasRenderingContext2D, dx: number, dy: number, dw: number, dh: number): void {
    if (!afePerfEnabled()) {
      ctx.drawImage(this.frame, dx, dy, dw, dh);
      return;
    }
    const t0 = performance.now();
    ctx.drawImage(this.frame, dx, dy, dw, dh);
    afePerfAdd("canvasDraw", performance.now() - t0);
  }

  drawWithFit(ctx: CanvasRenderingContext2D, _opts: { fit: "contain" }): void {
    const canvas = ctx.canvas;
    const srcW = this.frame.displayWidth || this.frame.codedWidth;
    const srcH = this.frame.displayHeight || this.frame.codedHeight;
    if (srcW < 2 || srcH < 2) return;
    const scale = Math.min(canvas.width / srcW, canvas.height / srcH);
    const w = srcW * scale;
    const h = srcH * scale;
    const draw = () => ctx.drawImage(this.frame, (canvas.width - w) / 2, (canvas.height - h) / 2, w, h);
    if (!afePerfEnabled()) {
      draw();
      return;
    }
    const t0 = performance.now();
    draw();
    afePerfAdd("canvasDraw", performance.now() - t0);
  }

  close(): void {
    const t0 = afePerfEnabled() ? performance.now() : 0;
    try {
      this.frame.close();
    } catch {
      /* already closed */
    }
    afePerfCount("framesClosed");
    if (t0) afePerfAdd("frameClose", performance.now() - t0);
  }
}

export class AfeScheduler {
  private readonly decoder: AfeVideoDecoder;
  private readonly cache: DecodedFrameCache;
  private nextDecode = 0;
  private warm = false;
  private closed = false;

  constructor(
    private readonly movie: AfeMovie,
    maxDecoded = 12,
  ) {
    this.decoder = new AfeVideoDecoder(movie);
    this.cache = new DecodedFrameCache(maxDecoded);
  }

  memoryStats(): AfeMemoryStats {
    return this.cache.stats();
  }

  close(): void {
    this.closed = true;
    this.warm = false;
    this.cache.clear();
    this.decoder.close();
  }

  async getFrameAt(timeSec: number, signal?: AbortSignal): Promise<DrawableFrame | null> {
    throwIfAborted(signal);
    if (this.closed) throw new AfeError("AFE_DECODE_FAILED", "scheduler closed", false);
    const index = sampleIndexAtTime(this.movie, timeSec);
    if (index == null) return null;
    afePerfCount("randomPathFrames");
    const frame = await this.decodeTo(index, signal);
    return this.wrap(frame, this.movie.samples[index]!);
  }

  async *getFramesAt(timesSec: readonly number[], signal?: AbortSignal): AsyncIterable<DrawableFrame | null> {
    throwIfAborted(signal);
    if (this.closed) throw new AfeError("AFE_DECODE_FAILED", "scheduler closed", false);
    const indexes = planSampleIndexes(this.movie, timesSec);
    let i = 0;
    while (i < indexes.length) {
      throwIfAborted(signal);
      if (indexes[i] == null) {
        yield null;
        i += 1;
        continue;
      }
      let last = indexes[i]!;
      let maxIdx = last;
      let j = i + 1;
      while (j < indexes.length) {
        const nxt = indexes[j];
        if (nxt == null) break;
        if (shouldSplitPresentationRun(this.movie, maxIdx, nxt)) break;
        maxIdx = Math.max(maxIdx, nxt);
        last = nxt;
        j += 1;
      }
      const decodeLast = maxDecodeIndex(indexes, i, j);
      const streamable =
        this.movie.cttsKind === "variable"
          ? isPresentationRun(this.movie, indexes, i, j)
          : isMonotonicRun(indexes, i, j);
      if (streamable || isPresentationRun(this.movie, indexes, i, j)) {
        yield* this.streamFramesAt(indexes, i, j, decodeLast, signal);
      } else {
        yield* this.legacyFramesAt(indexes, i, j, decodeLast >= 0 ? decodeLast : last, signal);
      }
      i = j;
    }
  }

  /**
   * Sequential export path: warm decoder, precomputed indexes, ready queue.
   * Yields the next requested frame as soon as it is decoded — never waits for
   * the rest of the batch. Public timestamps / nulls / close semantics unchanged.
   */
  private async *streamFramesAt(
    indexes: readonly (number | null)[],
    start: number,
    end: number,
    last: number,
    signal?: AbortSignal,
  ): AsyncIterable<DrawableFrame | null> {
    const span = planDecodeSpan(this.movie, indexes, start, end);
    if (!span) return;
    afePerfMax("prefetchWindow", PREFETCH);
    await this.ensureForward(indexes[start]!, signal);
    await this.decoder.ensure(signal);
    this.decoder.beginStream(span.needed, span.decodeStart);

    const pump = (requested: number) => {
      const target = Math.min(last, requested + PREFETCH);
      while (this.nextDecode <= target) {
        if (this.nextDecode > requested && this.decoder.pendingOutputCount >= PREFETCH) break;
        const sample = this.movie.samples[this.nextDecode];
        if (!sample) throw new AfeError("AFE_DECODE_FAILED", `missing sample ${this.nextDecode}`);
        this.decoder.submitEncoded(sample, signal);
        this.nextDecode += 1;
      }
    };

    try {
      for (let k = start; k < end; k++) {
        throwIfAborted(signal);
        const idx = indexes[k];
        if (idx == null) {
          yield null;
          continue;
        }
        if (idx < this.nextDecode && !this.decoder.knowsSample(idx)) {
          const cached = this.cache.takeClone(idx) ?? (await this.decodeTo(idx, signal));
          afePerfCount("streamPathFrames");
          yield this.wrap(cached, this.movie.samples[idx]!);
          continue;
        }
        try {
          pump(idx);
        } catch (e) {
          if (!isAfeError(e) || !/key frame/i.test(e.message)) throw e;
          await this.decoder.reset(signal);
          this.nextDecode = keyframeAtOrBefore(this.movie, idx);
          this.warm = true;
          this.decoder.beginStream(span.needed, span.decodeStart);
          pump(idx);
        }
        // WebCodecs may hold the last submitted sample until another decode()
        // or flush(). Mid-GOP starts (hard cut / Source In) used to submit
        // exactly through the first needed index and then wait forever.
        if (this.nextDecode === idx + 1 && this.nextDecode <= last) {
          const extra = this.movie.samples[this.nextDecode];
          if (extra) {
            this.decoder.submitEncoded(extra, signal);
            this.nextDecode += 1;
          }
        }
        let frame = this.decoder.takeReady(idx);
        if (frame) {
          afePerfCount("readyImmediate");
        } else {
          afePerfCount("framePromiseWaits");
          const t0 = afePerfEnabled() ? performance.now() : 0;
          if (idx === last || this.decoder.pendingOutputCount === 0) {
            await this.decoder.releaseHeld(signal);
            frame = this.decoder.takeReady(idx);
          }
          if (!frame) frame = await this.decoder.waitReady(idx, signal);
          if (t0) afePerfAdd("decodeQueueWait", performance.now() - t0);
        }
        if (idx === last && this.decoder.pendingOutputCount > 0) {
          await this.decoder.releaseHeld(signal);
          frame = frame ?? this.decoder.takeReady(idx);
        }
        if (!frame) throw new AfeError("AFE_DECODE_FAILED", `no output for sample ${idx}`);
        const nextIdx = k + 1 < end ? indexes[k + 1] : undefined;
        if (nextIdx === idx) {
          this.cache.put(idx, frame.clone());
        }
        afePerfCount("streamPathFrames");
        yield this.wrap(frame, this.movie.samples[idx]!);
      }
    } finally {
      this.decoder.drainStream((index, frame) => {
        this.cache.put(index, frame);
      });
      this.decoder.endStream();
    }
  }

  /** Fallback for a non-monotonic slice (should be rare; grouping already splits on rewind). */
  private async *legacyFramesAt(
    indexes: readonly (number | null)[],
    start: number,
    end: number,
    last: number,
    signal?: AbortSignal,
  ): AsyncIterable<DrawableFrame | null> {
    await this.ensureForward(indexes[start]!, signal);
    const pending = new Map<number, Promise<VideoFrame>>();
    const submitThrough = async (upto: number) => {
      if (this.nextDecode > upto) return;
      afePerfCount("decodeSpanCalls");
      await this.decoder.ensure(signal);
      for (let s = this.nextDecode; s <= upto; s++) {
        const sample = this.movie.samples[s];
        if (!sample) throw new AfeError("AFE_DECODE_FAILED", `missing sample ${s}`);
        pending.set(s, this.decoder.enqueueSample(sample, signal));
      }
      this.nextDecode = upto + 1;
    };
    for (let k = start; k < end; k++) {
      throwIfAborted(signal);
      const idx = indexes[k];
      if (idx == null) {
        yield null;
        continue;
      }
      if (idx < this.nextDecode && !pending.has(idx)) {
        const cached = this.cache.takeClone(idx) ?? (await this.decodeTo(idx, signal));
        yield this.wrap(cached, this.movie.samples[idx]!);
        continue;
      }
      const prefetch = Math.min(last, idx + PREFETCH);
      try {
        await submitThrough(prefetch);
      } catch (e) {
        if (!isAfeError(e) || !/key frame/i.test(e.message)) throw e;
        await this.decoder.reset(signal);
        this.nextDecode = keyframeAtOrBefore(this.movie, idx);
        this.warm = true;
        pending.clear();
        await submitThrough(prefetch);
      }
      const promise = pending.get(idx);
      pending.delete(idx);
      if (!promise) {
        yield null;
        continue;
      }
      if (idx === last) await this.decoder.releaseHeld(signal);
      yield this.wrap(await promise, this.movie.samples[idx]!);
    }
    for (const [idx, promise] of pending) {
      try {
        this.cache.put(idx, await promise);
      } catch {
        /* reset/abort */
      }
    }
  }

  private async ensureForward(start: number, signal?: AbortSignal): Promise<void> {
    const key = keyframeAtOrBefore(this.movie, start);
    const canContinue = this.warm && !this.decoder.needsKeyframe && this.nextDecode <= start;
    if (canContinue) return;
    await this.decoder.reset(signal);
    this.nextDecode = key;
    this.warm = true;
  }

  private wrap(frame: VideoFrame, sample: AfeSample): AfeDrawable {
    const t0 = afePerfEnabled() ? performance.now() : 0;
    const timestamp = sample.ptsTimescale / this.movie.timescale;
    const duration = sample.durationTimescale / this.movie.timescale;
    const drawable = new AfeDrawable(frame, timestamp, duration);
    afePerfCount("framesYielded");
    afePerfCount("videoFrameCreates");
    if (t0) afePerfAdd("videoFrameHandoff", performance.now() - t0);
    return drawable;
  }

  private async decodeTo(target: number, signal?: AbortSignal): Promise<VideoFrame> {
    const cached = this.cache.takeClone(target);
    if (cached) return cached;
    const produced = await this.decodeSpan(target, target, signal, false);
    const wanted = produced.get(target);
    for (const [index, frame] of produced) {
      if (index === target) continue;
      this.cache.put(index, frame);
    }
    if (wanted) {
      this.cache.put(target, wanted);
      return wanted.clone();
    }
    const again = this.cache.takeClone(target);
    if (!again) throw new AfeError("AFE_DECODE_FAILED", `no output for sample ${target}`);
    return again;
  }

  private async decodeSpan(
    from: number,
    to: number,
    signal?: AbortSignal,
    persist = false,
  ): Promise<Map<number, VideoFrame>> {
    afePerfCount("decodeSpanCalls");
    const start = Math.min(from, to);
    const end = Math.max(from, to);
    const key = keyframeAtOrBefore(this.movie, start);
    const canContinue = this.warm && !this.decoder.needsKeyframe && this.nextDecode <= start;
    if (!canContinue) {
      await this.decoder.reset(signal);
      this.nextDecode = key;
      this.warm = true;
    }

    if (this.nextDecode > end) return new Map();

    const run: AfeSample[] = [];
    for (let i = this.nextDecode; i <= end; i++) {
      const sample = this.movie.samples[i];
      if (!sample) throw new AfeError("AFE_DECODE_FAILED", `missing sample ${i}`);
      run.push(sample);
    }
    if (run.length === 0) return new Map();

    let frames: Map<number, VideoFrame>;
    try {
      frames = await this.decoder.decodeRange(run, signal, persist);
    } catch (e) {
      if (!isAfeError(e) || !/key frame/i.test(e.message)) throw e;
      await this.decoder.reset(signal);
      this.nextDecode = key;
      this.warm = true;
      const retry: AfeSample[] = [];
      for (let i = key; i <= end; i++) retry.push(this.movie.samples[i]!);
      frames = await this.decoder.decodeRange(retry, signal, persist);
    }
    this.nextDecode = end + 1;
    return frames;
  }
}
