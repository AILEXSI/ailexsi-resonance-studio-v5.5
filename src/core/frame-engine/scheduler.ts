import { DecodedFrameCache } from "./cache";
import { AfeVideoDecoder } from "./decoder";
import { AfeError, isAfeError, throwIfAborted } from "./errors";
import { decodeOrigin, earlierKeyframeOrigin, nextKeyframeAfter, sampleIndexAtTime } from "./mp4-reader";
import { afePerfAdd, afePerfCount, afePerfEnabled, afePerfMax } from "./perf";
import { isMonotonicRun, isPresentationRun, maxDecodeIndex, planDecodeSpan, planSampleIndexes, shouldSplitPresentationRun } from "./plan";
import {
  AFE_DECODE_STALL_MS,
  AFE_WAIT_EXACT_PTS_MS,
  formatStallMessage,
  hasFurtherUsefulInput,
  lastRequiredDecodeSample,
  mayEarlierKeyframeRecover,
  mayFinalFlush,
  nowMs,
  progressivePumpSliceEnd,
  pumpMoreSubmitEnd,
  pumpSubmitEnd,
  streamLookaheadSamples,
  type AfeStallSnapshot,
} from "./stall";
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
  private exportStallExtra: Partial<AfeStallSnapshot> = {};

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

  stallSnapshot(extra?: Partial<AfeStallSnapshot>): AfeStallSnapshot {
    return this.decoder.snapshot({
      decodeStartSample: extra?.decodeStartSample ?? this.exportStallExtra.decodeStartSample ?? null,
      gopKeyframeStart: extra?.gopKeyframeStart ?? this.exportStallExtra.gopKeyframeStart ?? null,
      ...this.exportStallExtra,
      ...extra,
    });
  }

  setExportStallExtra(extra: Partial<AfeStallSnapshot>): void {
    this.exportStallExtra = { ...this.exportStallExtra, ...extra };
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
    this.decoder.setPrefetchHint(PREFETCH);
    const requestedIndexes: number[] = [];
    for (let k = start; k < end; k++) {
      const idx = indexes[k];
      if (idx != null) requestedIndexes.push(idx);
    }
    const lastRequested = span.decodeEnd;
    const nextRefAfterLast = nextKeyframeAfter(this.movie, lastRequested);
    const lastRequired = lastRequiredDecodeSample({
      lastRequested,
      maxReorderSamples: this.movie.maxReorderSamples,
      prefetch: PREFETCH,
      sampleCount: this.movie.sampleCount,
      nextRefOrGop: nextRefAfterLast,
    });
    this.decoder.beginStream(span.needed, span.decodeStart, {
      lastRequested,
      lastRequiredDecodeSample: lastRequired,
      requestedIndexes,
    });

    const lookahead = streamLookaheadSamples(this.movie.maxReorderSamples, PREFETCH);
    afePerfMax("prefetchWindow", lookahead);

    const stallExtra = (idx: number): Partial<AfeStallSnapshot> => {
      const sample = this.movie.samples[idx]!;
      return {
        ...this.exportStallExtra,
        sourceSampleRequested: idx,
        requestedPtsUs: this.decoder.chunkTimestampUs(sample),
        gopKeyframeStart:
          this.decoder.currentGopKeyframeStart ?? decodeOrigin(this.movie, idx),
        decodeStartSample: span.decodeStart,
      };
    };

    const pumpThrough = async (target: number, requested: number, budgetEnd?: number) => {
      const phase = this.decoder.currentStallPhase ?? "PUMP_LOOKAHEAD";
      this.decoder.beginSubmitPhase(phase, this.nextDecode);
      try {
        while (this.nextDecode <= target) {
          if (this.decoder.isStreamReady(requested)) return;
          const canSubmit = await this.decoder.waitForDecodeCapacity(signal, { budgetEnd, requested });
          if (this.decoder.isStreamReady(requested)) return;
          if (!canSubmit) return;
          const sample = this.movie.samples[this.nextDecode];
          if (!sample) throw new AfeError("AFE_DECODE_FAILED", `missing sample ${this.nextDecode}`);
          this.decoder.submitEncoded(sample, signal);
          this.nextDecode += 1;
        }
      } finally {
        this.decoder.endSubmitPhase();
      }
    };

    const pump = async (requested: number, budgetEnd?: number) => {
      this.decoder.setStallPhase("PUMP_LOOKAHEAD");
      const target = pumpSubmitEnd({
        requested,
        last,
        nextDecode: this.nextDecode,
        sampleCount: this.movie.sampleCount,
        prefetch: PREFETCH,
        maxReorderSamples: this.movie.maxReorderSamples,
        pendingOutputCount: this.decoder.pendingOutputCount,
      });
      await pumpThrough(Math.min(target, lastRequired), requested, budgetEnd);
    };

    const pumpMore = async (requested: number, budgetEnd?: number) => {
      this.decoder.setStallPhase("PUMP_LOOKAHEAD");
      const nextRef = nextKeyframeAfter(this.movie, requested);
      const target = pumpMoreSubmitEnd({
        requested,
        nextDecode: this.nextDecode,
        sampleCount: this.movie.sampleCount,
        prefetch: PREFETCH,
        maxReorderSamples: this.movie.maxReorderSamples,
        nextRefOrGop: nextRef,
        lastRequested,
      });
      await pumpThrough(Math.min(target, lastRequired), requested, budgetEnd);
    };

    const recoverGop = async (requested: number, originOverride?: number) => {
      const origin = originOverride ?? decodeOrigin(this.movie, requested);
      const pts = this.decoder.chunkTimestampUs(this.movie.samples[requested]!);
      this.decoder.setStallPhase("GOP_RECOVERY");
      this.decoder.setGopKeyframeStart(origin);
      this.decoder.noteRecoveryAttempt();
      const extra = { ...stallExtra(requested), gopKeyframeStart: origin };
      this.decoder.bindOrigin(extra);
      this.decoder.markRecoveryRebuilding([requested]);
      await this.decoder.recreate(signal);
      this.nextDecode = origin;
      this.warm = true;
      this.decoder.beginStream(span.needed, span.decodeStart, {
        lastRequested,
        lastRequiredDecodeSample: lastRequired,
        requestedIndexes,
        keepResolved: true,
      });
      this.decoder.setPrefetchHint(PREFETCH);
      this.decoder.setGopKeyframeStart(origin);
      this.decoder.bindOrigin(extra);
      this.decoder.restoreOpenedIdentity(requested, pts);
      this.decoder.protectSample(requested);
      this.decoder.confirmPtsRegistered(requested, pts);
      this.decoder.assertOpenedOwnership(extra);
      await pump(requested);
      await pumpMore(requested);
      if (this.nextDecode <= requested) await pumpThrough(requested, requested);
      this.decoder.confirmPtsRegistered(requested, pts);
      this.decoder.assertOpenedOwnership(extra);
    };

    const throwStall = (requested: number): never => {
      this.decoder.assertOpenedOwnership(stallExtra(requested));
      const dump = this.decoder.snapshot({
        ...stallExtra(requested),
        stalledMs: AFE_DECODE_STALL_MS,
      });
      throw new AfeError("AFE_DECODE_STALL", formatStallMessage(dump), false);
    };

    const waitExact = async (requested: number, budgetEnd: number): Promise<VideoFrame | null> => {
      this.decoder.setStallPhase("WAIT_EXACT_PTS");
      const remain = budgetEnd - nowMs();
      if (remain <= 0) return null;
      return this.decoder.awaitReady(requested, signal, stallExtra(requested), {
        allowSkip: false,
        throwOnTimeout: false,
        timeoutMs: Math.min(AFE_WAIT_EXACT_PTS_MS, remain),
      });
    };

    const exactVideoFrame = async (idx: number): Promise<VideoFrame> => {
      const extra = stallExtra(idx);
      this.decoder.bindOrigin(extra);
      this.decoder.openRequested(idx, extra.requestedPtsUs);
      const budgetEnd = nowMs() + AFE_DECODE_STALL_MS;
      let recovered = false;
      let earlierWalked = this.decoder.earlierKeyframeRecoverUsed;
      const sliceSamples = streamLookaheadSamples(this.movie.maxReorderSamples, PREFETCH);

      const tryEarlierKeyframe = async (): Promise<boolean> => {
        if (earlierWalked || this.decoder.earlierKeyframeRecoverUsed) return false;
        const current = this.decoder.currentGopKeyframeStart ?? decodeOrigin(this.movie, idx);
        if (current <= 0) return false;
        const earlier = earlierKeyframeOrigin(this.movie, current);
        if (earlier == null) return false;
        if (!mayEarlierKeyframeRecover({
          frozenHighWaterAfterRecreate: this.decoder.isFrozenAtHighWaterAfterRecreate(),
          earlierKeyframeOrigin: earlier,
          earlierKeyframeRecovered: this.decoder.earlierKeyframeRecoverUsed,
          gopKeyframeStart: current,
          earlierKeyframeAvailable: true,
        })) {
          return false;
        }
        earlierWalked = true;
        this.decoder.noteEarlierKeyframeRecover();
        await recoverGop(idx, earlier);
        recovered = true;
        return true;
      };

      try {
        await pump(idx, budgetEnd);
      } catch (e) {
        if (!isAfeError(e) || !/key frame/i.test(e.message)) throw e;
        await recoverGop(idx);
        recovered = true;
      }

      let frame = this.decoder.takeReady(idx);
      if (frame) {
        afePerfCount("readyImmediate");
        this.decoder.markEncoded(idx);
        return frame;
      }

      afePerfCount("framePromiseWaits");
      const t0 = afePerfEnabled() ? performance.now() : 0;
      frame = await waitExact(idx, budgetEnd);
      if (!frame) {
        this.decoder.markRecoveryRebuilding([idx]);
        this.decoder.confirmPtsRegistered(idx, extra.requestedPtsUs);
        await pumpMore(idx, budgetEnd);
        this.decoder.confirmPtsRegistered(idx, extra.requestedPtsUs);
        this.decoder.assertOpenedOwnership(extra);
        frame = this.decoder.takeReady(idx) ?? (await waitExact(idx, budgetEnd));
      }
      const progressiveTowardRequired = async () => {
        while (
          !frame &&
          !this.decoder.isFrozenAtHighWaterAfterRecreate() &&
          hasFurtherUsefulInput({
            nextDecode: this.nextDecode,
            sampleCount: this.movie.sampleCount,
            lastRequiredDecodeSample: lastRequired,
          })
        ) {
          this.decoder.markRecoveryRebuilding([idx]);
          this.decoder.confirmPtsRegistered(idx, extra.requestedPtsUs);
          const sliceStart = this.nextDecode;
          const sliceEnd = progressivePumpSliceEnd({
            nextDecode: this.nextDecode,
            lastRequiredDecodeSample: lastRequired,
            sampleCount: this.movie.sampleCount,
            sliceSamples,
          });
          this.decoder.setStallPhase("PUMP_LOOKAHEAD");
          this.decoder.setPumpSlice(sliceStart, sliceEnd);
          const before = this.nextDecode;
          await pumpThrough(sliceEnd, idx, budgetEnd);
          this.decoder.confirmPtsRegistered(idx, extra.requestedPtsUs);
          this.decoder.assertOpenedOwnership(extra);
          frame = this.decoder.takeReady(idx) ?? (await waitExact(idx, budgetEnd));
          if (this.nextDecode === before) break;
          if (nowMs() >= budgetEnd) break;
        }
      };

      const tryFinalFlush = async () => {
        this.decoder.clearRecoveryRebuilding([idx]);
        const flushSnap = this.decoder.snapshot(extra);
        const canFlush = mayFinalFlush({
          unresolvedRequestedVideoFrames: this.decoder.unresolvedRequestedCount(),
          nextDecode: this.nextDecode,
          sampleCount: this.movie.sampleCount,
          lastRequiredDecodeSample: lastRequired,
          lastSubmittedSample: this.nextDecode - 1,
          streamWaiterIndex: flushSnap.streamWaiterIndex,
          recoveryRebuilding: false,
          transactionComplete: flushSnap.transactionComplete,
        });
        if (!canFlush || flushSnap.finalFlushAttempted) return;
        this.decoder.armFinalFlush([idx]);
        this.decoder.retainExactIdentity(idx, extra.requestedPtsUs);
        this.decoder.assertOpenedOwnership(extra);
        this.decoder.setStallPhase("FINAL_FLUSH");
        await this.decoder.flushTail(signal);
        this.decoder.retainExactIdentity(idx, extra.requestedPtsUs);
        this.decoder.assertOpenedOwnership(extra);
        frame = this.decoder.takeReady(idx);
        if (!frame) {
          const remain = Math.max(16, budgetEnd - nowMs());
          frame = await this.decoder.awaitReady(idx, signal, extra, {
            allowSkip: false,
            throwOnTimeout: false,
            timeoutMs: remain,
          });
        }
      };

      /* First-fill HIGH admits AFE-10 ~36 submits before any STEP C recreate. */
      if (!frame) await progressiveTowardRequired();
      if (!frame) await tryFinalFlush();
      if (!frame && !recovered) {
        await recoverGop(idx);
        recovered = true;
        frame = this.decoder.takeReady(idx) ?? (await waitExact(idx, budgetEnd));
        if (!frame) await progressiveTowardRequired();
      }
      if (!frame && this.decoder.isFrozenAtHighWaterAfterRecreate()) {
        if (await tryEarlierKeyframe()) {
          frame = this.decoder.takeReady(idx) ?? (await waitExact(idx, budgetEnd));
          if (!frame) await progressiveTowardRequired();
        }
      }
      if (!frame) await tryFinalFlush();
      if (t0) afePerfAdd("decodeQueueWait", performance.now() - t0);
      if (frame) {
        this.decoder.markEncoded(idx);
        return frame;
      }
      return throwStall(idx);
    };

    try {
      for (let k = start; k < end; k++) {
        throwIfAborted(signal);
        const idx = indexes[k];
        if (idx == null) {
          yield null;
          continue;
        }
        this.decoder.clearOrigin();
        this.decoder.openRequested(idx);
        if (idx < this.nextDecode && !this.decoder.knowsSample(idx)) {
          const cached = this.cache.takeClone(idx) ?? (await this.decodeTo(idx, signal));
          this.decoder.markResolvedRequested(idx);
          afePerfCount("streamPathFrames");
          yield this.wrap(cached, this.movie.samples[idx]!);
          continue;
        }
        const frame = await exactVideoFrame(idx);
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
        this.nextDecode = decodeOrigin(this.movie, idx);
        this.warm = true;
        pending.clear();
        await submitThrough(prefetch);
      }
      const promise = pending.get(idx);
      pending.delete(idx);
      if (!promise) {
        throw new AfeError("AFE_DECODE_FAILED", `no pending decode for sample ${idx}`, false);
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
    const key = decodeOrigin(this.movie, start);
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
    const key = decodeOrigin(this.movie, start);
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
