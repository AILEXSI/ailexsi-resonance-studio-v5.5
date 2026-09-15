import { decoderConfigOf } from "./avc-config";
import { AfeError, abortedError, isAfeError, throwIfAborted } from "./errors";
import { AFE_MAX_REORDER_READY, PtsIndexMap } from "./frame-match";
import { afePerfAdd, afePerfCount, afePerfEnabled, afePerfMarkDecoded, afePerfMax, afePerfProbeInstalled } from "./perf";
import {
  AFE_DECODE_STALL_MS,
  AFE_FLUSH_WATCHDOG_MS,
  AFE_SETTLE_DRAIN_MS,
  emptyStallSnapshot,
  formatStallMessage,
  nowMs,
  originFromStall,
  requestedPtsIsPending,
  streamLookaheadSamples,
  type AfeStallPhase,
  type AfeStallSnapshot,
} from "./stall";
import { sampleDurationToChunkDurationUs, samplePtsToChunkTimestampUs } from "./timestamps";
import type { AfeMovie, AfeSample } from "./types";
import { sampleBytes } from "./mp4-reader";

type FrameWaiter = { resolve: (frame: VideoFrame) => void; reject: (e: Error) => void };

export type AwaitReadyHooks = {
  /** Yield null when later presentation indexes are already ready (test-only hole). */
  allowSkip?: boolean;
  /** Return null instead of throwing when the wait budget expires. */
  throwOnTimeout?: boolean;
  timeoutMs?: number;
};

export class AfeVideoDecoder {
  private decoder: VideoDecoder | null = null;
  /** PTS(us) → waiter queue (duplicate timestamps stay FIFO within that PTS). */
  private waiters = new Map<number, FrameWaiter[]>();
  private generation = 0;
  private transactionId = 0;
  private closed = false;
  private lastError: Error | null = null;
  private configured = false;
  /** WebCodecs requires a key chunk after configure() or flush(). */
  needsKeyframe = true;

  /** Sequential stream: exact PTS(us) → queued sample indexes (decode-order submit). */
  private streamPts = new PtsIndexMap();
  private streamReady = new Map<number, VideoFrame>();
  private streamWaiter: (FrameWaiter & { index: number }) | null = null;
  private streamNeeded: Uint8Array | null = null;
  private streamDecodeStart = 0;
  private streamMode = false;
  private readonly reorderCap: number;
  private lastSubmittedSample: number | null = null;
  private lastVideoFrameTimestamp: number | null = null;
  private lastSampleResolved: number | null = null;
  private flushCount = 0;
  private resetCount = 0;
  private recreateCount = 0;
  private recoveryAttempts = 0;
  private prefetchHint = 4;
  private stallPhase: AfeStallPhase | null = null;
  private origin: Partial<AfeStallSnapshot> = {};
  private protectedIndexes = new Set<number>();

  constructor(private readonly movie: AfeMovie) {
    this.reorderCap = Math.min(
      AFE_MAX_REORDER_READY,
      Math.max(8, (movie.maxReorderSamples || 0) + 8),
    );
  }

  get isOpen(): boolean {
    return this.decoder != null && this.configured && !this.closed;
  }

  get readySize(): number {
    return this.streamReady.size;
  }

  get pendingOutputCount(): number {
    return this.streamPts.pendingCount() + this.streamReady.size;
  }

  get decodeQueueSize(): number {
    return this.decoder?.decodeQueueSize ?? 0;
  }

  get currentTransactionId(): number {
    return this.transactionId;
  }

  get currentStallPhase(): AfeStallPhase | null {
    return this.stallPhase;
  }

  setPrefetchHint(n: number): void {
    this.prefetchHint = Math.max(1, n | 0);
  }

  setStallPhase(phase: AfeStallPhase | null): void {
    this.stallPhase = phase;
  }

  noteRecoveryAttempt(): void {
    this.recoveryAttempts += 1;
  }

  fateOf(index: number) {
    return this.streamPts.fateOf(index);
  }

  allSubmittedTerminal(): boolean {
    return this.streamPts.allTerminal();
  }

  unresolvedSamples(): number[] {
    return this.streamPts.unresolved();
  }

  hasPendingPts(ptsUs: number | null | undefined): boolean {
    return requestedPtsIsPending(this.streamPts.pendingTimestamps(), ptsUs ?? null);
  }

  hasLaterReady(index: number): boolean {
    for (const ready of this.streamReady.keys()) {
      if (ready > index) return true;
    }
    return false;
  }

  protectSample(index: number): void {
    this.protectedIndexes.add(index);
  }

  /**
   * Bind originating request identity. Same sample keeps the first snapshot
   * across PUMP / GOP_RECOVERY / FINAL_FLUSH / RESET.
   */
  bindOrigin(fields: Partial<AfeStallSnapshot>): void {
    const next = originFromStall(fields);
    const sample = next.originRequestedSample ?? null;
    if (this.origin.originRequestedSample != null && this.origin.originRequestedSample === sample) {
      return;
    }
    this.origin = next;
    if (sample != null) this.protectedIndexes.add(sample);
  }

  clearOrigin(): void {
    this.origin = {};
  }

  snapshot(extra?: Partial<AfeStallSnapshot>): AfeStallSnapshot {
    const origin = originFromStall({ ...this.origin, ...extra });
    return emptyStallSnapshot({
      decodeStartSample: this.streamMode ? this.streamDecodeStart : null,
      lastSubmittedSample: this.lastSubmittedSample,
      decodeQueueSize: this.decodeQueueSize,
      streamPtsPending: this.streamPts.pendingCount(),
      streamReadySize: this.streamReady.size,
      streamWaiterIndex: this.streamWaiter?.index ?? null,
      reorderCap: this.reorderCap,
      lastVideoFrameTimestamp: this.lastVideoFrameTimestamp,
      lastSampleResolved: this.lastSampleResolved,
      decoderFlushCount: this.flushCount,
      decoderResetCount: this.resetCount,
      decoderRecreateCount: this.recreateCount,
      recoveryAttempts: this.recoveryAttempts,
      pendingPts: this.streamPts.pendingTimestamps(),
      readyIndexes: [...this.streamReady.keys()].sort((a, b) => a - b),
      lastDecodedTimestamp: this.lastVideoFrameTimestamp,
      lookahead: streamLookaheadSamples(this.movie.maxReorderSamples, this.prefetchHint),
      maxReorderSamples: this.movie.maxReorderSamples,
      stallPhase: this.stallPhase,
      transactionId: this.transactionId,
      ...origin,
      sourceSampleRequested: extra?.sourceSampleRequested ?? origin.sourceSampleRequested ?? null,
      requestedPtsUs: extra?.requestedPtsUs ?? origin.requestedPtsUs ?? null,
      ...extra,
      ...origin,
    });
  }

  async ensure(signal?: AbortSignal): Promise<void> {
    throwIfAborted(signal);
    if (this.closed) throw new AfeError("AFE_DECODE_FAILED", "decoder closed", false);
    if (this.decoder && this.configured) return;
    if (typeof VideoDecoder === "undefined") {
      throw new AfeError("AFE_DECODE_CONFIG_FAILED", "VideoDecoder unavailable");
    }
    this.transactionId += 1;
    const bornTxn = this.transactionId;
    this.decoder = new VideoDecoder({
      output: (frame) => this.onOutput(frame, bornTxn),
      error: (e) => this.onError(e, bornTxn),
    });
    if (!afePerfProbeInstalled()) afePerfCount("decoderCreates");
    try {
      const config = decoderConfigOf(this.movie.avc);
      const support = await VideoDecoder.isConfigSupported(config);
      throwIfAborted(signal);
      if (!support.supported) {
        this.teardown();
        throw new AfeError("AFE_DECODE_CONFIG_FAILED", `unsupported ${config.codec}`);
      }
      this.decoder.configure(config);
      this.configured = true;
      this.needsKeyframe = true;
      if (!afePerfProbeInstalled()) afePerfCount("decoderConfigures");
    } catch (e) {
      this.teardown();
      if (e instanceof AfeError) throw e;
      throw new AfeError("AFE_DECODE_CONFIG_FAILED", e instanceof Error ? e.message : String(e));
    }
  }

  async reset(signal?: AbortSignal): Promise<void> {
    throwIfAborted(signal);
    this.stallPhase = "RESET";
    this.generation += 1;
    this.streamMode = false;
    this.streamNeeded = null;
    this.rejectWaiters(new AfeError("AFE_DECODE_FAILED", "decoder reset", false));
    if (this.decoder && this.configured) {
      try {
        this.decoder.reset();
        this.resetCount += 1;
        if (!afePerfProbeInstalled()) afePerfCount("decoderResets");
        this.decoder.configure(decoderConfigOf(this.movie.avc));
        this.needsKeyframe = true;
        if (!afePerfProbeInstalled()) afePerfCount("decoderConfigures");
      } catch (e) {
        this.teardown();
        throw new AfeError("AFE_DECODE_FAILED", e instanceof Error ? e.message : String(e));
      }
    } else {
      await this.ensure(signal);
    }
  }

  /**
   * Close + new VideoDecoder. Invalidates the previous transaction so in-flight
   * WebView2 outputs cannot poison streamPts (Windows: decodeQueue=4, streamPts=0).
   * Origin identity is preserved.
   */
  async recreate(signal?: AbortSignal): Promise<void> {
    throwIfAborted(signal);
    this.stallPhase = "RESET";
    this.transactionId += 1;
    this.generation += 1;
    this.recreateCount += 1;
    this.resetCount += 1;
    this.lastError = null;
    this.streamWaiter = null;
    this.closeStreamFrames();
    this.streamPts.failPending("ABORTED");
    this.streamPts.clear();
    this.streamMode = false;
    this.streamNeeded = null;
    this.needsKeyframe = true;
    this.configured = false;
    if (this.decoder) {
      try {
        this.decoder.close();
      } catch {
        /* */
      }
      this.decoder = null;
    }
    if (!afePerfProbeInstalled()) afePerfCount("decoderResets");
    await this.ensure(signal);
  }

  /**
   * EncodedVideoChunk.timestamp := sample PTS in microseconds.
   * VideoFrame.timestamp is specified to copy that integer (not DTS, not FIFO index).
   */
  chunkTimestampUs(sample: AfeSample): number {
    return samplePtsToChunkTimestampUs(sample.ptsTimescale, this.movie.timescale);
  }

  beginStream(needed: Uint8Array, decodeStart: number): void {
    this.closeStreamFrames();
    this.streamPts.clear();
    this.streamMode = true;
    this.streamNeeded = needed;
    this.streamDecodeStart = decodeStart;
  }

  endStream(): void {
    this.stallPhase = "TRANSACTION_END";
    this.streamMode = false;
    this.streamNeeded = null;
    this.closeStreamFrames();
    for (const index of this.streamPts.unresolved()) {
      if (this.protectedIndexes.has(index)) {
        this.streamPts.mark(index, "ERROR");
        continue;
      }
      this.streamPts.mark(index, "DISCARDED_NOT_NEEDED");
    }
    this.streamPts.failPending("ERROR");
    if (this.streamWaiter) {
      const w = this.streamWaiter;
      this.streamWaiter = null;
      w.reject(new AfeError("AFE_DECODE_FAILED", "stream ended", false));
    }
    this.protectedIndexes.clear();
    this.clearOrigin();
  }

  drainStream(put: (index: number, frame: VideoFrame) => void): void {
    for (const [index, frame] of this.streamReady) {
      put(index, frame);
    }
    this.streamReady.clear();
  }

  knowsSample(index: number): boolean {
    if (this.streamReady.has(index) || this.streamWaiter?.index === index) return true;
    return this.streamPts.hasIndex(index);
  }

  takeReady(index: number): VideoFrame | null {
    const frame = this.streamReady.get(index);
    if (!frame) return null;
    this.streamReady.delete(index);
    this.streamPts.mark(index, "RESOLVED");
    this.lastSampleResolved = index;
    return frame;
  }

  waitReady(index: number, signal?: AbortSignal, extra?: Partial<AfeStallSnapshot>): Promise<VideoFrame> {
    return this.awaitReady(index, signal, extra, { allowSkip: false, throwOnTimeout: true }).then((frame) => {
      if (frame) return frame;
      const dump = this.snapshot({
        sourceSampleRequested: index,
        stalledMs: AFE_DECODE_STALL_MS,
        ...extra,
      });
      throw new AfeError("AFE_DECODE_STALL", formatStallMessage(dump), false);
    });
  }

  /**
   * Wait for exact PTS of `index`. No mid-run flush. Production video:
   * allowSkip=false — null only when the wait budget expires and throwOnTimeout
   * is false (scheduler then pumps / recovers / tail-flushes).
   */
  awaitReady(
    index: number,
    signal?: AbortSignal,
    extra?: Partial<AfeStallSnapshot>,
    hooks?: AwaitReadyHooks,
  ): Promise<VideoFrame | null> {
    this.bindOrigin({ sourceSampleRequested: index, ...extra });
    this.protectSample(index);
    if (!this.stallPhase) this.stallPhase = "WAIT_EXACT_PTS";
    const hit = this.takeReady(index);
    if (hit) return Promise.resolve(hit);
    throwIfAborted(signal);
    if (this.lastError) return Promise.reject(this.lastError);
    if (this.closed) return Promise.reject(new AfeError("AFE_DECODE_FAILED", "decoder closed", false));
    const timeoutMs = Math.max(0, hooks?.timeoutMs ?? AFE_DECODE_STALL_MS);
    const throwOnTimeout = hooks?.throwOnTimeout !== false;
    return new Promise<VideoFrame | null>((resolve, reject) => {
      const started = nowMs();
      let settled = false;
      const finish = (fn: () => void) => {
        if (settled) return;
        settled = true;
        clearTimeout(stallTimer);
        signal?.removeEventListener("abort", onAbort);
        fn();
      };
      const dumpStall = () =>
        this.snapshot({
          sourceSampleRequested: index,
          stalledMs: Math.max(timeoutMs, nowMs() - started),
          ...extra,
        });
      const throwStall = () => {
        const err = new AfeError("AFE_DECODE_STALL", formatStallMessage(dumpStall()), false);
        this.lastError = err;
        if (this.streamWaiter?.index === index) this.streamWaiter = null;
        this.streamPts.failPending("ERROR");
        finish(() => reject(err));
      };
      const trySkip = (): boolean => {
        if (!hooks?.allowSkip) return false;
        if (this.protectedIndexes.has(index)) return false;
        if (this.streamReady.has(index)) return false;
        if (!this.hasLaterReady(index)) return false;
        if (this.streamWaiter?.index === index) this.streamWaiter = null;
        if (this.streamPts.hasIndex(index)) {
          this.streamPts.deleteIndex(index);
          this.streamPts.mark(index, "DISCARDED_NOT_NEEDED");
        }
        finish(() => resolve(null));
        return true;
      };
      const onTimeout = () => {
        if (settled) return;
        const got = this.takeReady(index);
        if (got) {
          finish(() => resolve(got));
          return;
        }
        if (trySkip()) return;
        if (throwOnTimeout) {
          throwStall();
          return;
        }
        if (this.streamWaiter?.index === index) this.streamWaiter = null;
        finish(() => resolve(null));
      };
      const stallTimer = setTimeout(onTimeout, timeoutMs);
      const onAbort = () => {
        if (this.streamWaiter?.index === index) this.streamWaiter = null;
        this.rejectWaiters(abortedError(signal));
        this.dropDecoderAfterAbort();
        finish(() => reject(abortedError(signal)));
      };
      signal?.addEventListener("abort", onAbort, { once: true });
      this.streamWaiter = {
        index,
        resolve: (f) => finish(() => resolve(f)),
        reject: (e) => finish(() => reject(e)),
      };
    });
  }

  /**
   * Submit one sample after ensure(). No Promise — output lands on the ready queue.
   * Sequential export uses this so the consumer can pull without per-frame resolvers.
   */
  submitEncoded(sample: AfeSample, signal?: AbortSignal): void {
    throwIfAborted(signal);
    if (!this.decoder) throw new AfeError("AFE_DECODE_FAILED", "decoder missing");
    if (this.lastError) throw this.lastError;
    const { timestamp, chunk } = this.makeChunk(sample);
    this.streamPts.push(timestamp, sample.index);
    this.lastSubmittedSample = sample.index;
    try {
      this.decoder.decode(chunk);
      if (sample.isKeyframe) this.needsKeyframe = false;
    } catch (e) {
      this.streamPts.deleteIndex(sample.index);
      this.streamPts.mark(sample.index, "ERROR");
      throw new AfeError("AFE_DECODE_FAILED", e instanceof Error ? e.message : String(e));
    }
    afePerfMax("inFlightPeak", this.pendingOutputCount);
  }

  /** Submit one sample after ensure(). Decode order is the call order. Does not flush. */
  enqueueSample(sample: AfeSample, signal?: AbortSignal): Promise<VideoFrame> {
    throwIfAborted(signal);
    if (!this.decoder) throw new AfeError("AFE_DECODE_FAILED", "decoder missing");
    if (this.lastError) throw this.lastError;
    const { timestamp, chunk } = this.makeChunk(sample);
    const promise = new Promise<VideoFrame>((resolve, reject) => {
      const waiter: FrameWaiter = {
        resolve: (f) => {
          signal?.removeEventListener("abort", onAbort);
          resolve(f);
        },
        reject: (e) => {
          signal?.removeEventListener("abort", onAbort);
          reject(e);
        },
      };
      const onAbort = () => {
        const q = this.waiters.get(timestamp);
        if (q) {
          const pos = q.indexOf(waiter);
          if (pos >= 0) q.splice(pos, 1);
          if (q.length === 0) this.waiters.delete(timestamp);
        }
        reject(abortedError(signal));
      };
      signal?.addEventListener("abort", onAbort, { once: true });
      let q = this.waiters.get(timestamp);
      if (!q) {
        q = [];
        this.waiters.set(timestamp, q);
      }
      q.push(waiter);
    });
    this.lastSubmittedSample = sample.index;
    try {
      this.decoder.decode(chunk);
      if (sample.isKeyframe) this.needsKeyframe = false;
    } catch (e) {
      const q = this.waiters.get(timestamp);
      if (q) {
        q.pop();
        if (q.length === 0) this.waiters.delete(timestamp);
      }
      throw new AfeError("AFE_DECODE_FAILED", e instanceof Error ? e.message : String(e));
    }
    return promise;
  }

  async submitSample(sample: AfeSample, signal?: AbortSignal): Promise<VideoFrame> {
    await this.ensure(signal);
    return this.enqueueSample(sample, signal);
  }

  async releaseHeld(signal?: AbortSignal): Promise<void> {
    await this.flushTail(signal);
  }

  /** Tail / transaction-end flush only. Watchdog → AFE_DECODE_STALL. */
  async flushTail(signal?: AbortSignal): Promise<void> {
    this.stallPhase = "FINAL_FLUSH";
    await this.settleOutputs(signal, false);
  }

  /**
   * Decode `samples` in order. Do not flush between sequential calls — flush()
   * forces the next chunk to be a keyframe and destroys forward state.
   */
  async decodeRange(
    samples: AfeSample[],
    signal?: AbortSignal,
    persist = false,
  ): Promise<Map<number, VideoFrame>> {
    throwIfAborted(signal);
    if (samples.length === 0) return new Map();
    await this.ensure(signal);
    const gen = this.generation;
    const pending: { index: number; promise: Promise<VideoFrame> }[] = [];
    for (const sample of samples) {
      pending.push({ index: sample.index, promise: this.enqueueSample(sample, signal) });
    }
    await this.settleOutputs(signal, persist);
    const out = new Map<number, VideoFrame>();
    for (const item of pending) {
      const frame = await item.promise;
      if (this.closed || gen !== this.generation) {
        try {
          frame.close();
        } catch {
          /* */
        }
        throw new AfeError("AFE_DECODE_FAILED", "decoder superseded", false);
      }
      out.set(item.index, frame);
    }
    throwIfAborted(signal);
    return out;
  }

  /**
   * Wait for VideoDecoder outputs without flush() when possible.
   * flush() is the transaction-tail drain only — never an ordinary stall nudge.
   */
  private async settleOutputs(signal?: AbortSignal, persist = false): Promise<void> {
    const dec = this.decoder;
    if (!dec) return;
    if (this.waiterCount() === 0 && this.streamPts.pendingCount() === 0 && !this.streamWaiter) return;

    this.stallPhase = this.stallPhase === "FINAL_FLUSH" ? "FINAL_FLUSH" : "DECODER_DRAIN";

    const waitDequeue = () =>
      new Promise<void>((resolve) => {
        const done = () => {
          dec.removeEventListener("dequeue", done);
          clearTimeout(timer);
          resolve();
        };
        const timer = setTimeout(done, 16);
        dec.addEventListener("dequeue", done);
      });

    const drainStart = nowMs();
    while (dec.decodeQueueSize > 0 && nowMs() - drainStart < AFE_SETTLE_DRAIN_MS) {
      throwIfAborted(signal);
      await waitDequeue();
    }

    if (persist && (this.waiterCount() > 0 || this.streamPts.pendingCount() > 0 || this.streamWaiter)) {
      const stallMs = 40;
      let lastSize = this.waiterCount() + this.streamPts.pendingCount();
      let lastChange = typeof performance !== "undefined" ? performance.now() : Date.now();
      while (this.waiterCount() > 0 || this.streamPts.pendingCount() > 0 || this.streamWaiter) {
        throwIfAborted(signal);
        const now = typeof performance !== "undefined" ? performance.now() : Date.now();
        if (now - lastChange >= stallMs) break;
        await new Promise<void>((r) => setTimeout(r, 0));
        const size = this.waiterCount() + this.streamPts.pendingCount();
        if (size < lastSize) {
          lastSize = size;
          lastChange = typeof performance !== "undefined" ? performance.now() : Date.now();
        }
      }
    }

    if (this.waiterCount() === 0 && this.streamPts.pendingCount() === 0 && !this.streamWaiter) return;
    this.stallPhase = "FINAL_FLUSH";
    try {
      let flushTimer: ReturnType<typeof setTimeout> | undefined;
      this.flushCount += 1;
      if (!afePerfProbeInstalled()) afePerfCount("decoderFlushes");
      try {
        await Promise.race([
          dec.flush(),
          new Promise<never>((_, reject) => {
            flushTimer = setTimeout(() => {
              const dump = this.snapshot({ stalledMs: AFE_FLUSH_WATCHDOG_MS });
              reject(new AfeError("AFE_DECODE_STALL", `decoder flush stall; ${formatStallMessage(dump)}`, false));
            }, AFE_FLUSH_WATCHDOG_MS);
          }),
        ]);
      } finally {
        if (flushTimer) clearTimeout(flushTimer);
      }
      this.needsKeyframe = true;
    } catch (e) {
      if (signal?.aborted) throw abortedError(signal);
      if (isAfeError(e)) throw e;
      throw new AfeError("AFE_DECODE_FAILED", e instanceof Error ? e.message : String(e));
    }
  }

  close(): void {
    this.closed = true;
    this.generation += 1;
    this.transactionId += 1;
    this.rejectWaiters(new AfeError("AFE_ABORTED", "decoder closed", false));
    this.teardown();
  }

  private isNeeded(index: number): boolean {
    if (this.protectedIndexes.has(index)) return true;
    if (!this.streamNeeded) return true;
    const i = index - this.streamDecodeStart;
    return i >= 0 && i < this.streamNeeded.length && this.streamNeeded[i] === 1;
  }

  private makeChunk(sample: AfeSample): { timestamp: number; chunk: EncodedVideoChunk } {
    if (this.needsKeyframe && !sample.isKeyframe) {
      throw new AfeError("AFE_DECODE_FAILED", "key frame required after configure/flush", false);
    }
    const timestamp = this.chunkTimestampUs(sample);
    const read0 = afePerfEnabled() && typeof performance !== "undefined" ? performance.now() : 0;
    const data = sampleBytes(this.movie, sample);
    if (afePerfEnabled()) {
      afePerfAdd("encodedSampleRead", performance.now() - read0);
      afePerfMarkDecoded(sample.index);
    }
    return {
      timestamp,
      chunk: new EncodedVideoChunk({
        type: sample.isKeyframe ? "key" : "delta",
        timestamp,
        duration: sampleDurationToChunkDurationUs(sample.durationTimescale, this.movie.timescale),
        data,
      }),
    };
  }

  private resolveStream(index: number, frame: VideoFrame): boolean {
    if (this.streamWaiter?.index === index) {
      this.streamPts.mark(index, "RESOLVED");
      this.lastSampleResolved = index;
      const w = this.streamWaiter;
      this.streamWaiter = null;
      w.resolve(frame);
      return true;
    }
    const prev = this.streamReady.get(index);
    if (prev && prev !== frame) {
      try {
        prev.close();
      } catch {
        /* */
      }
    }
    if (!this.streamReady.has(index) && this.streamReady.size >= this.reorderCap) {
      try {
        frame.close();
      } catch {
        /* */
      }
      this.streamPts.mark(index, "ERROR");
      const err = new AfeError(
        "AFE_DECODE_FAILED",
        `reorder buffer exceeded (${this.streamReady.size} >= ${this.reorderCap})`,
        false,
      );
      this.lastError = err;
      this.rejectWaiters(err);
      return true;
    }
    this.streamPts.mark(index, "READY");
    this.streamReady.set(index, frame);
    afePerfMax("inFlightPeak", this.pendingOutputCount);
    return true;
  }

  /** Exact PTS(us) only. No FIFO identity, no nearest/snap. */
  private matchStreamIndex(timestamp: number): number | undefined {
    return this.streamPts.takeExact(timestamp);
  }

  private takeWaiter(timestamp: number): FrameWaiter | undefined {
    const q = this.waiters.get(timestamp);
    if (!q || q.length === 0) return undefined;
    const w = q.shift()!;
    if (q.length === 0) this.waiters.delete(timestamp);
    return w;
  }

  private waiterCount(): number {
    let n = 0;
    for (const q of this.waiters.values()) n += q.length;
    return n;
  }

  private failUnmatched(frame: VideoFrame, timestamp: number): void {
    try {
      frame.close();
    } catch {
      /* */
    }
    const err = new AfeError(
      "AFE_DECODE_FAILED",
      `unmatched VideoFrame timestamp ${timestamp} (PTS-keyed exact match only)`,
      false,
    );
    if (this.streamMode || this.streamWaiter || this.waiterCount() > 0) {
      this.lastError = err;
      this.rejectWaiters(err);
    }
  }

  private onOutput(frame: VideoFrame, txn: number): void {
    afePerfCount("framesDecoded");
    if (this.closed || txn !== this.transactionId) {
      try {
        frame.close();
      } catch {
        /* */
      }
      return;
    }
    this.lastVideoFrameTimestamp = frame.timestamp;
    if (this.streamMode) {
      const idx = this.matchStreamIndex(frame.timestamp);
      if (idx != null) {
        if (!this.isNeeded(idx)) {
          frame.close();
          this.streamPts.mark(idx, this.protectedIndexes.has(idx) ? "ERROR" : "DISCARDED_NOT_NEEDED");
          return;
        }
        this.resolveStream(idx, frame);
        return;
      }
      this.failUnmatched(frame, frame.timestamp);
      return;
    }
    const waiter = this.takeWaiter(frame.timestamp);
    if (waiter) {
      waiter.resolve(frame);
      return;
    }
    this.failUnmatched(frame, frame.timestamp);
  }

  private onError(e: DOMException, txn: number): void {
    if (txn !== this.transactionId) return;
    const err = new AfeError("AFE_DECODE_FAILED", e.message || "VideoDecoder error");
    this.lastError = err;
    this.rejectWaiters(err);
  }

  private rejectWaiters(err: Error): void {
    const pending: FrameWaiter[] = [];
    for (const q of this.waiters.values()) pending.push(...q);
    this.waiters.clear();
    for (const w of pending) w.reject(err);
    if (this.streamWaiter) {
      const w = this.streamWaiter;
      this.streamWaiter = null;
      w.reject(err);
    }
    this.closeStreamFrames();
    const fate =
      isAfeError(err) && err.code === "AFE_ABORTED" ? "ABORTED" : "ERROR";
    this.streamPts.failPending(fate);
  }

  private dropDecoderAfterAbort(): void {
    if (!this.decoder || !this.configured) return;
    this.transactionId += 1;
    try {
      this.decoder.reset();
      this.resetCount += 1;
      this.decoder.configure(decoderConfigOf(this.movie.avc));
      this.needsKeyframe = true;
    } catch {
      this.teardown();
    }
  }

  private closeStreamFrames(): void {
    for (const frame of this.streamReady.values()) {
      try {
        frame.close();
      } catch {
        /* already closed */
      }
    }
    this.streamReady.clear();
  }

  private teardown(): void {
    this.configured = false;
    this.needsKeyframe = true;
    this.closeStreamFrames();
    this.streamPts.clear();
    this.streamMode = false;
    this.streamNeeded = null;
    if (this.decoder) {
      try {
        this.decoder.close();
      } catch {
        /* already closed */
      }
    }
    this.decoder = null;
  }
}
