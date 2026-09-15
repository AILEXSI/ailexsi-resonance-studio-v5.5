import { decoderConfigOf } from "./avc-config";
import { AfeError, abortedError, throwIfAborted } from "./errors";
import { afePerfAdd, afePerfCount, afePerfEnabled, afePerfMarkDecoded, afePerfMax, afePerfProbeInstalled } from "./perf";
import type { AfeMovie, AfeSample } from "./types";
import { sampleBytes } from "./mp4-reader";

type FrameWaiter = { resolve: (frame: VideoFrame) => void; reject: (e: Error) => void };

export class AfeVideoDecoder {
  private decoder: VideoDecoder | null = null;
  private waiters = new Map<number, FrameWaiter>();
  private generation = 0;
  private closed = false;
  private lastError: Error | null = null;
  private configured = false;
  /** WebCodecs requires a key chunk after configure() or flush(). */
  needsKeyframe = true;

  /** Sequential stream: timestamp(us) → sample index for in-flight encoded chunks. */
  private streamTs = new Map<number, number>();
  /** Submit order for no-B-frame streams (output order == decode order). */
  private streamOrder: number[] = [];
  private streamReady = new Map<number, VideoFrame>();
  private streamWaiter: (FrameWaiter & { index: number }) | null = null;
  private streamNeeded: Uint8Array | null = null;
  private streamDecodeStart = 0;
  private streamMode = false;

  constructor(private readonly movie: AfeMovie) {}

  get isOpen(): boolean {
    return this.decoder != null && this.configured && !this.closed;
  }

  get readySize(): number {
    return this.streamReady.size;
  }

  get pendingOutputCount(): number {
    return this.streamTs.size + this.streamReady.size;
  }

  async ensure(signal?: AbortSignal): Promise<void> {
    throwIfAborted(signal);
    if (this.closed) throw new AfeError("AFE_DECODE_FAILED", "decoder closed", false);
    if (this.decoder && this.configured) return;
    if (typeof VideoDecoder === "undefined") {
      throw new AfeError("AFE_DECODE_CONFIG_FAILED", "VideoDecoder unavailable");
    }
    this.decoder = new VideoDecoder({
      output: (frame) => this.onOutput(frame),
      error: (e) => this.onError(e),
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
    this.streamMode = false;
    this.streamNeeded = null;
    this.rejectWaiters(new AfeError("AFE_DECODE_FAILED", "decoder reset", false));
    if (this.decoder && this.configured) {
      try {
        this.decoder.reset();
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

  chunkTimestampUs(sample: AfeSample): number {
    return Math.round((sample.ptsTimescale / this.movie.timescale) * 1_000_000);
  }

  beginStream(needed: Uint8Array, decodeStart: number): void {
    this.closeStreamFrames();
    this.streamTs.clear();
    this.streamOrder.length = 0;
    this.streamMode = true;
    this.streamNeeded = needed;
    this.streamDecodeStart = decodeStart;
  }

  endStream(): void {
    this.streamMode = false;
    this.streamNeeded = null;
    this.closeStreamFrames();
    this.streamTs.clear();
    this.streamOrder.length = 0;
    if (this.streamWaiter) {
      const w = this.streamWaiter;
      this.streamWaiter = null;
      w.reject(new AfeError("AFE_DECODE_FAILED", "stream ended", false));
    }
  }

  drainStream(put: (index: number, frame: VideoFrame) => void): void {
    for (const [index, frame] of this.streamReady) {
      put(index, frame);
    }
    this.streamReady.clear();
  }

  knowsSample(index: number): boolean {
    if (this.streamReady.has(index) || this.streamWaiter?.index === index) return true;
    return this.streamOrder.includes(index);
  }

  takeReady(index: number): VideoFrame | null {
    const frame = this.streamReady.get(index);
    if (!frame) return null;
    this.streamReady.delete(index);
    return frame;
  }

  waitReady(index: number, signal?: AbortSignal): Promise<VideoFrame> {
    const hit = this.takeReady(index);
    if (hit) return Promise.resolve(hit);
    throwIfAborted(signal);
    if (this.lastError) return Promise.reject(this.lastError);
    if (this.closed) return Promise.reject(new AfeError("AFE_DECODE_FAILED", "decoder closed", false));
    return new Promise<VideoFrame>((resolve, reject) => {
      const onAbort = () => {
        if (this.streamWaiter?.index === index) this.streamWaiter = null;
        reject(abortedError(signal));
      };
      signal?.addEventListener("abort", onAbort, { once: true });
      this.streamWaiter = {
        index,
        resolve: (f) => {
          signal?.removeEventListener("abort", onAbort);
          resolve(f);
        },
        reject: (e) => {
          signal?.removeEventListener("abort", onAbort);
          reject(e);
        },
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
    this.streamTs.set(timestamp, sample.index);
    this.streamOrder.push(sample.index);
    try {
      this.decoder.decode(chunk);
      if (sample.isKeyframe) this.needsKeyframe = false;
    } catch (e) {
      this.streamTs.delete(timestamp);
      if (this.streamOrder[this.streamOrder.length - 1] === sample.index) this.streamOrder.pop();
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
      const onAbort = () => {
        this.waiters.delete(timestamp);
        reject(abortedError(signal));
      };
      signal?.addEventListener("abort", onAbort, { once: true });
      this.waiters.set(timestamp, {
        resolve: (f) => {
          signal?.removeEventListener("abort", onAbort);
          resolve(f);
        },
        reject: (e) => {
          signal?.removeEventListener("abort", onAbort);
          reject(e);
        },
      });
    });
    try {
      this.decoder.decode(chunk);
      if (sample.isKeyframe) this.needsKeyframe = false;
    } catch (e) {
      this.waiters.delete(timestamp);
      throw new AfeError("AFE_DECODE_FAILED", e instanceof Error ? e.message : String(e));
    }
    return promise;
  }

  async submitSample(sample: AfeSample, signal?: AbortSignal): Promise<VideoFrame> {
    await this.ensure(signal);
    return this.enqueueSample(sample, signal);
  }

  async releaseHeld(signal?: AbortSignal): Promise<void> {
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
   * flush() forces the next chunk to be a keyframe and makes the scheduler
   * restart the GOP — measured AFE-02 baseline: 102 chunks for 60 frames.
   */
  private async settleOutputs(signal?: AbortSignal, persist = false): Promise<void> {
    const dec = this.decoder;
    if (!dec) return;
    if (this.waiters.size === 0 && this.streamTs.size === 0 && !this.streamWaiter) return;

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

    while (dec.decodeQueueSize > 0) {
      throwIfAborted(signal);
      await waitDequeue();
    }

    if (persist && (this.waiters.size > 0 || this.streamTs.size > 0 || this.streamWaiter)) {
      const stallMs = 40;
      let lastSize = this.waiters.size + this.streamTs.size;
      let lastChange = typeof performance !== "undefined" ? performance.now() : Date.now();
      while (this.waiters.size > 0 || this.streamTs.size > 0 || this.streamWaiter) {
        throwIfAborted(signal);
        const now = typeof performance !== "undefined" ? performance.now() : Date.now();
        if (now - lastChange >= stallMs) break;
        await new Promise<void>((r) => setTimeout(r, 0));
        const size = this.waiters.size + this.streamTs.size;
        if (size < lastSize) {
          lastSize = size;
          lastChange = typeof performance !== "undefined" ? performance.now() : Date.now();
        }
      }
    }

    if (this.waiters.size === 0 && this.streamTs.size === 0 && !this.streamWaiter) return;
    try {
      await dec.flush();
      if (!afePerfProbeInstalled()) afePerfCount("decoderFlushes");
      this.needsKeyframe = true;
    } catch (e) {
      if (signal?.aborted) throw abortedError(signal);
      throw new AfeError("AFE_DECODE_FAILED", e instanceof Error ? e.message : String(e));
    }
  }

  close(): void {
    this.closed = true;
    this.generation += 1;
    this.rejectWaiters(new AfeError("AFE_ABORTED", "decoder closed", false));
    this.teardown();
  }

  private isNeeded(index: number): boolean {
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
        duration: Math.max(1, Math.round((sample.durationTimescale / this.movie.timescale) * 1_000_000)),
        data,
      }),
    };
  }

  private resolveStream(index: number, frame: VideoFrame): boolean {
    if (this.streamWaiter?.index === index) {
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
    this.streamReady.set(index, frame);
    afePerfMax("inFlightPeak", this.pendingOutputCount);
    return true;
  }

  /**
   * AFE rejects B-frames (varying ctts), so output order equals submit/decode
   * order. Assign FIFO first — timestamp nearest-match was observed to drop a
   * mid-GOP requested frame (hard-cut / Source In) and stall waitReady forever.
   */
  private matchStreamIndex(timestamp: number): number | undefined {
    const fifo = this.streamOrder.shift();
    if (fifo != null) {
      const mapped = this.streamTs.get(timestamp);
      if (mapped === fifo) this.streamTs.delete(timestamp);
      else {
        for (const [ts, idx] of this.streamTs) {
          if (idx === fifo) {
            this.streamTs.delete(ts);
            break;
          }
        }
      }
      return fifo;
    }
    const exact = this.streamTs.get(timestamp);
    if (exact != null) {
      this.streamTs.delete(timestamp);
      return exact;
    }
    return undefined;
  }

  private onOutput(frame: VideoFrame): void {
    afePerfCount("framesDecoded");
    if (this.closed) {
      frame.close();
      return;
    }
    if (this.streamMode) {
      const idx = this.matchStreamIndex(frame.timestamp);
      if (idx != null) {
        if (!this.isNeeded(idx)) {
          frame.close();
          return;
        }
        this.resolveStream(idx, frame);
        return;
      }
    }
    const waiter = this.waiters.get(frame.timestamp);
    if (waiter) {
      this.waiters.delete(frame.timestamp);
      waiter.resolve(frame);
      return;
    }
    let best: number | undefined;
    let bestDelta = Infinity;
    for (const ts of this.waiters.keys()) {
      const d = Math.abs(ts - frame.timestamp);
      if (d < bestDelta) {
        bestDelta = d;
        best = ts;
      }
    }
    if (best != null && bestDelta < 2) {
      const w = this.waiters.get(best);
      this.waiters.delete(best);
      w?.resolve(frame);
      return;
    }
    frame.close();
  }

  private onError(e: DOMException): void {
    const err = new AfeError("AFE_DECODE_FAILED", e.message || "VideoDecoder error");
    this.lastError = err;
    this.rejectWaiters(err);
  }

  private rejectWaiters(err: Error): void {
    const pending = [...this.waiters.values()];
    this.waiters.clear();
    for (const w of pending) w.reject(err);
    if (this.streamWaiter) {
      const w = this.streamWaiter;
      this.streamWaiter = null;
      w.reject(err);
    }
    this.closeStreamFrames();
    this.streamTs.clear();
    this.streamOrder.length = 0;
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
    this.streamTs.clear();
    this.streamOrder.length = 0;
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
