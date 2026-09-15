import { decoderConfigOf } from "./avc-config";
import { AfeError, abortedError, isAfeError, throwIfAborted } from "./errors";
import { AFE_MAX_REORDER_READY, PtsIndexMap } from "./frame-match";
import { afePerfAdd, afePerfCount, afePerfEnabled, afePerfMarkDecoded, afePerfMax, afePerfProbeInstalled } from "./perf";
import {
  AFE_DECODE_STALL_MS,
  AFE_FLUSH_WATCHDOG_MS,
  AFE_SETTLE_DRAIN_MS,
  classifySampleRole,
  decodeQueueHighWater,
  emptyStallSnapshot,
  formatStallMessage,
  isTransactionComplete,
  lastRequiredDecodeSample,
  requestedEncodedInvariantHolds,
  mayFinalFlush,
  maySubmitEncoded,
  nowMs,
  originFromStall,
  requestOwnershipHolds,
  usefulInputExhausted,
  requestedPtsIsPending,
  streamLookaheadSamples,
  type AfeStallPhase,
  type AfeStallSnapshot,
  type RequestOwnershipState,
  type SampleRole,
  type SubmitPhaseTrace,
} from "./stall";
import { sampleDurationToChunkDurationUs, samplePtsToChunkTimestampUs } from "./timestamps";
import type { AfeMovie, AfeSample } from "./types";
import { sampleBytes } from "./mp4-reader";

type FrameWaiter = { resolve: (frame: VideoFrame) => void; reject: (e: Error) => void };

type OpenedRequestOwnership = {
  index: number;
  ptsUs: number | null;
  transitions: RequestOwnershipState[];
  waiterActive: boolean;
  ptsRegistered: boolean;
  recoveryRebuilding: boolean;
  rebuilt: boolean;
};

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
  private requestedIndexes = new Set<number>();
  /** Planned presentation indexes the export has actually asked for. */
  private openedRequested = new Set<number>();
  private resolvedRequested = new Set<number>();
  private lastRequestedSample: number | null = null;
  private lastRequiredSample: number | null = null;
  private streamDecodeStartBound = 0;
  private speculativeSubmitted = 0;
  private cancelledSpeculativeSamples = 0;
  private decodeQueueBeforeCancel: number | null = null;
  private decoderResetForTransactionEnd = false;
  private sampleRoles = new Map<number, SampleRole>();
  private ownership = new Map<number, OpenedRequestOwnership>();
  private pumpSliceStart: number | null = null;
  private pumpSliceEnd: number | null = null;
  private finalFlushAttempted = false;
  private finalFlushArmed = false;
  private decodeQueuePeak = 0;
  private submitsWithoutOutputProgress = 0;
  private lastOutputProgressTimestamp: number | null = null;
  private lastDecodedAtSubmit: number | null = null;
  private backpressureWaitCount = 0;
  private backpressureBlocked = false;
  private noMoreSubmission = false;
  private submitPhaseTraces: SubmitPhaseTrace[] = [];
  private openSubmitPhase: SubmitPhaseTrace | null = null;
  private readonly capacityOutputWaiters = new Set<() => void>();
  private readonly capacityExactWaiters = new Set<() => void>();

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

  /** Derived HIGH_WATER — maxReorder + lookahead + B-frame need, never near 125. */
  get decodeQueueHighWater(): number {
    return decodeQueueHighWater(this.movie.maxReorderSamples, this.prefetchHint);
  }

  isStreamReady(index: number): boolean {
    return this.streamReady.has(index);
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

  private ensureOwnership(index: number, ptsUs?: number | null): OpenedRequestOwnership {
    let rec = this.ownership.get(index);
    if (!rec) {
      const sample = this.movie.samples[index];
      rec = {
        index,
        ptsUs: ptsUs ?? (sample ? this.chunkTimestampUs(sample) : null),
        transitions: ["OPEN_REQUEST"],
        waiterActive: false,
        ptsRegistered: false,
        recoveryRebuilding: false,
        rebuilt: false,
      };
      this.ownership.set(index, rec);
    } else if (ptsUs != null && rec.ptsUs == null) {
      rec.ptsUs = ptsUs;
    }
    return rec;
  }

  private noteOwnership(index: number, state: RequestOwnershipState): void {
    const rec = this.ownership.get(index) ?? this.ensureOwnership(index);
    const last = rec.transitions[rec.transitions.length - 1];
    if (last === state) return;
    rec.transitions.push(state);
  }

  private noteWaiterInstalled(index: number): void {
    const rec = this.ensureOwnership(index);
    rec.waiterActive = true;
    if (rec.recoveryRebuilding || rec.rebuilt) {
      rec.rebuilt = true;
      rec.recoveryRebuilding = false;
      this.noteOwnership(index, "WAIT_REINSTALLED");
    } else {
      this.noteOwnership(index, "WAIT_INSTALLED");
    }
  }

  private noteWaiterCleared(index: number): void {
    const rec = this.ownership.get(index);
    if (rec) rec.waiterActive = false;
  }

  roleOf(index: number): SampleRole | undefined {
    return this.sampleRoles.get(index);
  }

  /**
   * Opened presentation samples not yet resolved. Planned-but-unasked indexes
   * and GOP-resubmitted already-resolved samples do not count.
   */
  unresolvedRequestedCount(): number {
    let n = 0;
    for (const index of this.openedRequested) {
      if (this.isResolvedRequested(index)) continue;
      n += 1;
    }
    return n;
  }

  openedRequestedCount(): number {
    return this.openedRequested.size;
  }

  resolvedRequestedCount(): number {
    let n = 0;
    for (const index of this.openedRequested) {
      if (this.isResolvedRequested(index)) n += 1;
    }
    return n;
  }

  /** Export actually asked for this presentation sample (exact-PTS waiter / yield). */
  openRequested(index: number, ptsUs?: number | null): void {
    this.openedRequested.add(index);
    this.requestedIndexes.add(index);
    this.protectSample(index);
    if (this.isResolvedRequested(index)) return;
    this.ensureOwnership(index, ptsUs);
  }

  markResolvedRequested(index: number): void {
    this.openedRequested.add(index);
    this.resolvedRequested.add(index);
    this.noteOwnership(index, "RESOLVED");
    const rec = this.ownership.get(index);
    if (rec) {
      rec.waiterActive = false;
      rec.recoveryRebuilding = false;
    }
  }

  markEncoded(index: number): void {
    this.noteOwnership(index, "ENCODED");
  }

  ownershipTrace(index: number): RequestOwnershipState[] {
    return [...(this.ownership.get(index)?.transitions ?? [])];
  }

  setPumpSlice(start: number, end: number): void {
    this.pumpSliceStart = start;
    this.pumpSliceEnd = end;
  }

  beginSubmitPhase(phase: AfeStallPhase, submittedFrom: number | null): void {
    this.openSubmitPhase = {
      phase,
      submittedFrom,
      submittedTo: submittedFrom,
      decodeQueueStart: this.decodeQueueSize,
      decodeQueueEnd: this.decodeQueueSize,
      lastDecodedStart: this.lastVideoFrameTimestamp,
      lastDecodedEnd: this.lastVideoFrameTimestamp,
      pausedForCapacity: false,
      outputProgressed: false,
    };
  }

  endSubmitPhase(): void {
    const open = this.openSubmitPhase;
    if (!open) return;
    open.submittedTo = this.lastSubmittedSample;
    open.decodeQueueEnd = this.decodeQueueSize;
    open.lastDecodedEnd = this.lastVideoFrameTimestamp;
    open.outputProgressed = open.lastDecodedEnd !== open.lastDecodedStart;
    this.submitPhaseTraces.push(open);
    if (this.submitPhaseTraces.length > 16) this.submitPhaseTraces.shift();
    this.openSubmitPhase = null;
  }

  /**
   * Pause when decodeQueueSize >= HIGH_WATER and there is no output progress.
   * Resumes on dequeue, VideoFrame output, or exact-PTS resolve.
   * No busy loop. No arbitrary sleep. No mid-run flush.
   *
   * Returns false when the caller must not submit more. Before the first
   * recreate, that is a stop-for-STEP-C signal (do not 3s-stall). After
   * recreate, a still-stuck HIGH_WATER queue is a typed AFE_DECODE_STALL.
   */
  async waitForDecodeCapacity(
    signal?: AbortSignal,
    opts?: { budgetEnd?: number; requested?: number },
  ): Promise<boolean> {
    throwIfAborted(signal);
    const high = this.decodeQueueHighWater;
    this.noteQueuePeak();
    const requested = opts?.requested;
    if (requested != null && this.streamReady.has(requested)) return true;
    const outputProgressed = this.lastVideoFrameTimestamp !== this.lastDecodedAtSubmit;
    if (
      maySubmitEncoded({
        decodeQueueSize: this.decodeQueueSize,
        highWater: high,
        outputProgressed,
      })
    ) {
      this.noMoreSubmission = false;
      this.backpressureBlocked = false;
      return true;
    }
    this.noMoreSubmission = true;
    this.backpressureWaitCount += 1;
    this.backpressureBlocked = true;
    if (this.openSubmitPhase) this.openSubmitPhase.pausedForCapacity = true;
    if (this.recreateCount === 0) return false;
    const tsAtPause = this.lastVideoFrameTimestamp;
    const deadline = opts?.budgetEnd ?? nowMs() + AFE_DECODE_STALL_MS;
    const dec = this.decoder;
    while (this.decodeQueueSize >= high) {
      throwIfAborted(signal);
      if (requested != null && this.streamReady.has(requested)) {
        this.backpressureBlocked = false;
        this.noMoreSubmission = false;
        return true;
      }
      if (this.lastError) throw this.lastError;
      const remain = deadline - nowMs();
      if (remain <= 0) {
        if (this.lastVideoFrameTimestamp === tsAtPause && this.decodeQueueSize >= high) {
          this.noMoreSubmission = true;
          const dump = this.snapshot({
            sourceSampleRequested: requested ?? this.origin.sourceSampleRequested ?? null,
            stalledMs: AFE_DECODE_STALL_MS,
          });
          const err = new AfeError("AFE_DECODE_STALL", formatStallMessage(dump), false);
          this.lastError = err;
          throw err;
        }
        this.backpressureBlocked = false;
        return this.decodeQueueSize < high;
      }
      const reason = await this.waitCapacitySignal(dec, signal, remain);
      if (reason === "exact" || (requested != null && this.streamReady.has(requested))) {
        this.backpressureBlocked = false;
        this.noMoreSubmission = false;
        return true;
      }
      if (this.lastVideoFrameTimestamp !== tsAtPause || this.decodeQueueSize < high) {
        this.noMoreSubmission = false;
        this.backpressureBlocked = this.decodeQueueSize >= high;
        if (this.decodeQueueSize < high) return true;
      }
    }
    this.backpressureBlocked = false;
    this.noMoreSubmission = false;
    return true;
  }

  private waitCapacitySignal(
    dec: VideoDecoder | null,
    signal: AbortSignal | undefined,
    timeoutMs: number,
  ): Promise<"dequeue" | "output" | "exact" | "timeout"> {
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (reason: "dequeue" | "output" | "exact" | "timeout") => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        dec?.removeEventListener("dequeue", onDequeue);
        this.capacityOutputWaiters.delete(onOutput);
        this.capacityExactWaiters.delete(onExact);
        signal?.removeEventListener("abort", onAbort);
        resolve(reason);
      };
      const onDequeue = () => finish("dequeue");
      const onOutput = () => finish("output");
      const onExact = () => finish("exact");
      const onAbort = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        dec?.removeEventListener("dequeue", onDequeue);
        this.capacityOutputWaiters.delete(onOutput);
        this.capacityExactWaiters.delete(onExact);
        signal?.removeEventListener("abort", onAbort);
        reject(abortedError(signal));
      };
      const timer = setTimeout(() => finish("timeout"), Math.max(0, timeoutMs));
      this.capacityOutputWaiters.add(onOutput);
      this.capacityExactWaiters.add(onExact);
      dec?.addEventListener("dequeue", onDequeue);
      signal?.addEventListener("abort", onAbort, { once: true });
    });
  }

  private noteQueuePeak(): void {
    const q = this.decodeQueueSize;
    if (q > this.decodeQueuePeak) this.decodeQueuePeak = q;
  }

  private notifyCapacityOutput(): void {
    if (this.capacityOutputWaiters.size === 0) return;
    const waiters = [...this.capacityOutputWaiters];
    this.capacityOutputWaiters.clear();
    for (const fn of waiters) fn();
  }

  private notifyCapacityExact(): void {
    if (this.capacityExactWaiters.size === 0) return;
    const waiters = [...this.capacityExactWaiters];
    this.capacityExactWaiters.clear();
    for (const fn of waiters) fn();
  }

  markRecoveryRebuilding(indexes?: Iterable<number>): void {
    const ids = indexes ? [...indexes] : [...this.openedRequested].filter((i) => !this.isResolvedRequested(i));
    for (const index of ids) {
      const rec = this.ensureOwnership(index);
      if (!rec.transitions.includes("RECOVERY_START")) this.noteOwnership(index, "RECOVERY_START");
      rec.recoveryRebuilding = true;
      rec.waiterActive = false;
      rec.ptsRegistered = false;
      this.noteOwnership(index, "RECOVERY_REBUILDING");
    }
  }

  /**
   * Re-bind opened identity after recreate/reset. Ledger already survived;
   * PTS map + waiter are restored by resubmit + awaitReady.
   */
  restoreOpenedIdentity(index: number, ptsUs?: number | null): void {
    this.openRequested(index, ptsUs);
    this.protectSample(index);
    const rec = this.ensureOwnership(index, ptsUs);
    rec.recoveryRebuilding = true;
    if (ptsUs != null) rec.ptsUs = ptsUs;
    if (this.sampleRoles.get(index) !== "REQUESTED") {
      this.sampleRoles.set(index, "REQUESTED");
    }
  }

  armFinalFlush(indexes?: Iterable<number>): void {
    this.finalFlushArmed = true;
    this.finalFlushAttempted = true;
    this.stallPhase = "FINAL_FLUSH";
    const ids = indexes
      ? [...indexes]
      : [...this.openedRequested].filter((i) => !this.isResolvedRequested(i));
    for (const index of ids) {
      const rec = this.ensureOwnership(index);
      rec.recoveryRebuilding = false;
      rec.waiterActive = false;
      this.noteOwnership(index, "FINAL_FLUSH_ARMED");
    }
  }

  clearRecoveryRebuilding(indexes?: Iterable<number>): void {
    const ids = indexes
      ? [...indexes]
      : [...this.openedRequested].filter((i) => !this.isResolvedRequested(i));
    for (const index of ids) {
      const rec = this.ownership.get(index);
      if (rec) rec.recoveryRebuilding = false;
    }
  }

  usefulInputIsExhausted(): boolean {
    const lastRequired = this.lastRequiredSample ?? this.lastSubmittedSample ?? -1;
    return usefulInputExhausted({
      lastSubmittedSample: this.lastSubmittedSample,
      lastRequiredDecodeSample: lastRequired,
      nextDecode: (this.lastSubmittedSample ?? -1) + 1,
      sampleCount: this.movie.sampleCount,
    });
  }

  confirmPtsRegistered(index: number, ptsUs?: number | null): boolean {
    const sample = this.movie.samples[index];
    const pts = ptsUs ?? (sample ? this.chunkTimestampUs(sample) : this.ownership.get(index)?.ptsUs ?? null);
    const rec = this.ensureOwnership(index, pts);
    if (this.streamReady.has(index) || this.isResolvedRequested(index)) {
      rec.ptsRegistered = true;
      this.noteOwnership(index, "PTS_REGISTERED");
      return true;
    }
    if (pts != null && !this.streamPts.hasIndex(index)) {
      this.streamPts.push(pts, index);
    }
    rec.ptsRegistered = this.streamPts.hasIndex(index) || (pts != null && this.hasPendingPts(pts));
    if (rec.ptsRegistered) this.noteOwnership(index, "PTS_REGISTERED");
    return rec.ptsRegistered;
  }

  assertOpenedOwnership(extra?: Partial<AfeStallSnapshot>): void {
    const unresolved = [...this.openedRequested].filter((i) => !this.isResolvedRequested(i));
    if (unresolved.length === 0) return;
    const waiter = this.streamWaiter?.index ?? null;
    const pending = this.streamPts.pendingCount();
    const rebuilding = unresolved.some((i) => this.ownership.get(i)?.recoveryRebuilding);
    const ptsRegistered = unresolved.some((i) => this.ownership.get(i)?.ptsRegistered);
    const flushArmed = this.finalFlushArmed || this.stallPhase === "FINAL_FLUSH";
    if (
      requestOwnershipHolds({
        unresolvedRequestedVideoFrames: unresolved.length,
        streamWaiterIndex: waiter,
        pendingPtsCount: pending,
        ptsRegistered,
        recoveryRebuilding: rebuilding,
        finalFlushArmed: flushArmed,
        finalFlushInProgress: this.stallPhase === "FINAL_FLUSH",
      })
    ) {
      return;
    }
    for (const index of unresolved) this.noteOwnership(index, "OWNERSHIP_LOST");
    const focus = extra?.sourceSampleRequested ?? unresolved[0]!;
    const dump = this.snapshot({
      sourceSampleRequested: focus,
      ...extra,
    });
    throw new AfeError("AFE_REQUEST_OWNERSHIP_LOST", formatStallMessage(dump), false);
  }

  private isResolvedRequested(index: number): boolean {
    return this.resolvedRequested.has(index) || this.streamPts.fateOf(index) === "RESOLVED";
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
    const unresolved = extra?.unresolvedRequestedVideoFrames ?? this.unresolvedRequestedCount();
    const waiter = extra?.streamWaiterIndex ?? this.streamWaiter?.index ?? null;
    const req = extra?.videoFramesRequested ?? this.origin.videoFramesRequested ?? null;
    const dec = extra?.videoFramesDecoded ?? this.origin.videoFramesDecoded ?? null;
    const enc = extra?.videoFramesEncoded ?? this.origin.videoFramesEncoded ?? null;
    const opened = extra?.openedRequestedVideoFrames ?? this.openedRequested.size;
    const focus = extra?.sourceSampleRequested ?? origin.sourceSampleRequested ?? waiter;
    const rec = focus != null ? this.ownership.get(focus) : undefined;
    const unresolvedRecs = [...this.openedRequested].filter((i) => !this.isResolvedRequested(i));
    const rebuilding =
      extra?.recoveryRebuilding ??
      unresolvedRecs.some((i) => this.ownership.get(i)?.recoveryRebuilding === true);
    const lastRequired = extra?.lastRequiredDecodeSample ?? this.lastRequiredSample;
    const lastSubmitted = extra?.lastSubmittedSample ?? this.lastSubmittedSample;
    const usefulExhausted =
      extra?.usefulInputExhausted ??
      (lastRequired != null &&
        usefulInputExhausted({
          lastSubmittedSample: lastSubmitted,
          lastRequiredDecodeSample: lastRequired,
          nextDecode: (lastSubmitted ?? -1) + 1,
          sampleCount: this.movie.sampleCount,
        }));
    const ptsRegistered =
      extra?.ptsRegistered ??
      (focus != null
        ? this.streamPts.hasIndex(focus) ||
          this.hasPendingPts(extra?.requestedPtsUs ?? rec?.ptsUs) ||
          rec?.ptsRegistered === true
        : this.streamPts.pendingCount() > 0);
    const invariantOk = requestedEncodedInvariantHolds({
      unresolvedRequestedVideoFrames: unresolved,
      videoFramesRequested: req,
      videoFramesEncoded: enc,
    });
    const complete =
      invariantOk &&
      isTransactionComplete({
        unresolvedRequestedVideoFrames: unresolved,
        streamWaiterIndex: waiter,
        requestedVideoFrameCount: opened,
        resolvedRequestedVideoFrames: this.resolvedRequestedCount(),
        openedRequestedVideoFrames: opened,
        videoFramesRequested: req,
        videoFramesDecoded: dec,
        videoFramesEncoded: enc,
      });
    return emptyStallSnapshot({
      decodeStartSample: this.streamMode ? this.streamDecodeStart : null,
      lastSubmittedSample: this.lastSubmittedSample,
      decodeQueueSize: this.decodeQueueSize,
      streamPtsPending: this.streamPts.pendingCount(),
      streamReadySize: this.streamReady.size,
      streamWaiterIndex: waiter,
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
      lastRequestedSample: extra?.lastRequestedSample ?? this.lastRequestedSample,
      lastRequiredDecodeSample: extra?.lastRequiredDecodeSample ?? this.lastRequiredSample,
      speculativeSamplesSubmitted: extra?.speculativeSamplesSubmitted ?? this.speculativeSubmitted,
      cancelledSpeculativeSamples: extra?.cancelledSpeculativeSamples ?? this.cancelledSpeculativeSamples,
      decodeQueueBeforeCancel: extra?.decodeQueueBeforeCancel ?? this.decodeQueueBeforeCancel,
      decoderResetForTransactionEnd:
        extra?.decoderResetForTransactionEnd ?? this.decoderResetForTransactionEnd,
      openedRequestedVideoFrames: extra?.openedRequestedVideoFrames ?? opened,
      unresolvedRequestedVideoFrames: extra?.unresolvedRequestedVideoFrames ?? unresolved,
      transactionComplete: extra?.transactionComplete ?? complete,
      pumpSliceStart: extra?.pumpSliceStart ?? this.pumpSliceStart,
      pumpSliceEnd: extra?.pumpSliceEnd ?? this.pumpSliceEnd,
      ptsRegistered: extra?.ptsRegistered ?? ptsRegistered,
      ownershipWaiterActive: extra?.ownershipWaiterActive ?? (waiter != null || rec?.waiterActive === true),
      ownershipRebuilt: extra?.ownershipRebuilt ?? [...this.ownership.values()].some((r) => r.rebuilt),
      recoveryRebuilding: extra?.recoveryRebuilding ?? rebuilding,
      ownershipState: extra?.ownershipState ?? rec?.transitions[rec.transitions.length - 1] ?? null,
      finalFlushAttempted: extra?.finalFlushAttempted ?? this.finalFlushAttempted,
      finalFlushArmed: extra?.finalFlushArmed ?? this.finalFlushArmed,
      usefulInputExhausted: extra?.usefulInputExhausted ?? usefulExhausted,
      decodeQueueHighWater: extra?.decodeQueueHighWater ?? this.decodeQueueHighWater,
      decodeQueuePeak: extra?.decodeQueuePeak ?? this.decodeQueuePeak,
      submitsWithoutOutputProgress:
        extra?.submitsWithoutOutputProgress ?? this.submitsWithoutOutputProgress,
      backpressureWaitCount: extra?.backpressureWaitCount ?? this.backpressureWaitCount,
      backpressureBlocked: extra?.backpressureBlocked ?? this.backpressureBlocked,
      noMoreSubmission: extra?.noMoreSubmission ?? this.noMoreSubmission,
      lastOutputProgressTimestamp:
        extra?.lastOutputProgressTimestamp ?? this.lastOutputProgressTimestamp,
      submitPhaseTraces: extra?.submitPhaseTraces ?? [...this.submitPhaseTraces],
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
    const openedUnresolved = [...this.openedRequested].filter((i) => !this.isResolvedRequested(i));
    if (openedUnresolved.length > 0) this.markRecoveryRebuilding(openedUnresolved);
    this.generation += 1;
    this.streamMode = false;
    this.streamNeeded = null;
    this.rejectWaiters(new AfeError("AFE_DECODE_FAILED", "decoder reset", false), {
      keepOpenedOwnership: openedUnresolved.length > 0,
    });
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
    const openedUnresolved = [...this.openedRequested].filter((i) => !this.isResolvedRequested(i));
    if (openedUnresolved.length > 0) this.markRecoveryRebuilding(openedUnresolved);
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
    this.lastSubmittedSample = null;
    this.lastVideoFrameTimestamp = null;
    this.lastDecodedAtSubmit = null;
    this.submitsWithoutOutputProgress = 0;
    this.backpressureBlocked = false;
    this.noMoreSubmission = false;
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

  beginStream(
    needed: Uint8Array,
    decodeStart: number,
    bounds?: {
      lastRequested: number;
      lastRequiredDecodeSample: number;
      requestedIndexes?: Iterable<number>;
      keepResolved?: boolean;
    },
  ): void {
    this.closeStreamFrames();
    this.streamPts.clear();
    this.streamMode = true;
    this.streamNeeded = needed;
    this.streamDecodeStart = decodeStart;
    this.streamDecodeStartBound = decodeStart;
    this.requestedIndexes.clear();
    this.sampleRoles.clear();
    if (!bounds?.keepResolved) {
      this.resolvedRequested.clear();
      this.openedRequested.clear();
      this.ownership.clear();
    } else {
      for (const index of this.openedRequested) {
        if (this.isResolvedRequested(index)) continue;
        this.restoreOpenedIdentity(index);
      }
    }
    this.speculativeSubmitted = 0;
    this.cancelledSpeculativeSamples = 0;
    this.decodeQueueBeforeCancel = null;
    this.decoderResetForTransactionEnd = false;
    this.decodeQueuePeak = 0;
    this.submitsWithoutOutputProgress = 0;
    this.backpressureWaitCount = 0;
    this.backpressureBlocked = false;
    this.noMoreSubmission = false;
    this.lastOutputProgressTimestamp = null;
    this.lastDecodedAtSubmit = null;
    this.submitPhaseTraces = [];
    this.openSubmitPhase = null;
    if (bounds) {
      this.lastRequestedSample = bounds.lastRequested;
      this.lastRequiredSample = bounds.lastRequiredDecodeSample;
      if (bounds.requestedIndexes) {
        for (const index of bounds.requestedIndexes) this.requestedIndexes.add(index);
      }
    } else {
      this.lastRequestedSample = decodeStart + Math.max(0, needed.length - 1);
      this.lastRequiredSample = lastRequiredDecodeSample({
        lastRequested: this.lastRequestedSample,
        maxReorderSamples: this.movie.maxReorderSamples,
        prefetch: this.prefetchHint,
        sampleCount: this.movie.sampleCount,
      });
    }
    if (this.requestedIndexes.size === 0) {
      for (let i = 0; i < needed.length; i++) {
        if (needed[i] === 1) this.requestedIndexes.add(decodeStart + i);
      }
    }
    for (const index of this.requestedIndexes) this.protectSample(index);
  }

  /**
   * Transaction tail: if every requested VIDEO sample is already terminal,
   * abandon leftover speculative WebCodecs work. Not a decode failure.
   * Never flush decodeQueueSize>0 speculative samples.
   */
  endStream(): void {
    this.streamMode = false;
    this.streamNeeded = null;
    const unresolvedRequested: number[] = [];
    const cancelled: number[] = [];
    const leftoverReady = [...this.streamReady.keys()];
    this.closeStreamFrames();
    for (const index of leftoverReady) {
      if (this.openedRequested.has(index) && !this.isResolvedRequested(index)) continue;
      this.streamPts.mark(index, "DISCARDED_NOT_NEEDED");
      cancelled.push(index);
    }
    for (const index of this.streamPts.unresolved()) {
      const openedUnresolved = this.openedRequested.has(index) && !this.isResolvedRequested(index);
      if (openedUnresolved) {
        this.streamPts.mark(index, "ERROR");
        unresolvedRequested.push(index);
        continue;
      }
      this.streamPts.mark(index, "DISCARDED_NOT_NEEDED");
      cancelled.push(index);
    }
    for (const index of this.openedRequested) {
      if (this.isResolvedRequested(index)) continue;
      if (!unresolvedRequested.includes(index)) unresolvedRequested.push(index);
    }
    this.streamPts.failPending("ERROR");
    this.cancelledSpeculativeSamples = cancelled.length;
    this.decodeQueueBeforeCancel = this.decodeQueueSize;
    const waiter = this.streamWaiter;
    const openedUnresolved = unresolvedRequested.length;
    const complete =
      openedUnresolved === 0 &&
      waiter == null &&
      isTransactionComplete({
        unresolvedRequestedVideoFrames: 0,
        streamWaiterIndex: null,
        openedRequestedVideoFrames: this.openedRequested.size,
        requestedVideoFrameCount: this.openedRequested.size,
        resolvedRequestedVideoFrames: this.resolvedRequestedCount(),
      });
    if (waiter && openedUnresolved > 0) {
      /* Keep the exact-PTS waiter identity for the stall dump. */
    } else if (waiter) {
      this.streamWaiter = null;
      waiter.reject(new AfeError("AFE_DECODE_FAILED", "stream ended", false));
    }
    if (complete || openedUnresolved === 0) {
      this.stallPhase = "TRANSACTION_END";
      this.abandonSpeculativeDecoder();
    }
    this.protectedIndexes.clear();
    /* Keep origin for post-stream stall dumps (AFE-07 identity). */
  }

  private classifySubmitted(index: number): SampleRole {
    return classifySampleRole(index, {
      requestedIndexes: this.requestedIndexes,
      decodeStart: this.streamDecodeStartBound,
      lastRequiredDecodeSample: this.lastRequiredSample ?? index,
    });
  }

  /**
   * Invalidate generation, drop tracking, reset/recreate so stale callbacks
   * cannot poison the next transaction. Does not flush. Does not stall.
   */
  private abandonSpeculativeDecoder(): void {
    this.generation += 1;
    this.transactionId += 1;
    this.decoderResetForTransactionEnd = true;
    this.resetCount += 1;
    this.lastError = null;
    if (this.decoder && this.configured) {
      try {
        this.decoder.reset();
        this.decoder.configure(decoderConfigOf(this.movie.avc));
        this.needsKeyframe = true;
        if (!afePerfProbeInstalled()) afePerfCount("decoderResets");
      } catch {
        try {
          this.decoder.close();
        } catch {
          /* */
        }
        this.decoder = null;
        this.configured = false;
        this.needsKeyframe = true;
      }
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
    return this.streamPts.hasIndex(index);
  }

  takeReady(index: number): VideoFrame | null {
    this.openRequested(index);
    const frame = this.streamReady.get(index);
    if (!frame) return null;
    this.streamReady.delete(index);
    this.streamPts.mark(index, "RESOLVED");
    this.markResolvedRequested(index);
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
    this.openRequested(index, extra?.requestedPtsUs ?? extra?.originRequestedPts);
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
        this.noteWaiterCleared(index);
        this.streamPts.failPending("ERROR");
        this.noteOwnership(index, "ERROR");
        finish(() => reject(err));
      };
      const trySkip = (): boolean => {
        if (!hooks?.allowSkip) return false;
        if (this.protectedIndexes.has(index)) return false;
        if (this.streamReady.has(index)) return false;
        if (!this.hasLaterReady(index)) return false;
        if (this.streamWaiter?.index === index) this.streamWaiter = null;
        this.noteWaiterCleared(index);
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
        this.noteWaiterCleared(index);
        const rec = this.ownership.get(index);
        const pending = this.streamPts.pendingCount();
        const usefulDone = this.usefulInputIsExhausted();
        const flushOwns = this.finalFlushArmed || this.stallPhase === "FINAL_FLUSH";
        if (
          this.openedRequested.has(index) &&
          !this.isResolvedRequested(index) &&
          pending === 0 &&
          !rec?.recoveryRebuilding &&
          !rec?.ptsRegistered &&
          !usefulDone &&
          !flushOwns
        ) {
          this.noteOwnership(index, "OWNERSHIP_LOST");
          const err = new AfeError("AFE_REQUEST_OWNERSHIP_LOST", formatStallMessage(dumpStall()), false);
          this.lastError = err;
          finish(() => reject(err));
          return;
        }
        finish(() => resolve(null));
      };
      const stallTimer = setTimeout(onTimeout, timeoutMs);
      const onAbort = () => {
        if (this.streamWaiter?.index === index) this.streamWaiter = null;
        this.noteWaiterCleared(index);
        this.noteOwnership(index, "ABORTED");
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
      this.noteWaiterInstalled(index);
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
    const role = this.classifySubmitted(sample.index);
    this.sampleRoles.set(sample.index, role);
    if (role === "SPECULATIVE") this.speculativeSubmitted += 1;
    if (role === "REQUESTED") this.protectSample(sample.index);
    this.streamPts.push(timestamp, sample.index);
    this.lastSubmittedSample = sample.index;
    if (this.lastVideoFrameTimestamp === this.lastDecodedAtSubmit) {
      this.submitsWithoutOutputProgress += 1;
    } else {
      this.submitsWithoutOutputProgress = 0;
      this.lastDecodedAtSubmit = this.lastVideoFrameTimestamp;
    }
    if (this.openedRequested.has(sample.index) && !this.isResolvedRequested(sample.index)) {
      this.confirmPtsRegistered(sample.index, timestamp);
    }
    try {
      this.decoder.decode(chunk);
      if (sample.isKeyframe) this.needsKeyframe = false;
      this.noteQueuePeak();
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

  /** Tail / useful-input-exhausted flush only. Watchdog → AFE_DECODE_STALL. */
  async flushTail(signal?: AbortSignal): Promise<void> {
    const unresolved = this.unresolvedRequestedCount();
    const lastRequired = this.lastRequiredSample ?? this.lastSubmittedSample ?? 0;
    const exhausted = this.usefulInputIsExhausted();
    if (unresolved <= 0) return;
    if (!this.finalFlushArmed && !exhausted) {
      if (
        !mayFinalFlush({
          unresolvedRequestedVideoFrames: unresolved,
          nextDecode: (this.lastSubmittedSample ?? -1) + 1,
          sampleCount: this.movie.sampleCount,
          lastRequiredDecodeSample: lastRequired,
          lastSubmittedSample: this.lastSubmittedSample,
        })
      ) {
        return;
      }
    }
    this.armFinalFlush();
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
    const unresolvedRequested = this.unresolvedRequestedCount();
    if (this.waiterCount() === 0 && unresolvedRequested === 0 && !this.streamWaiter) return;
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
      this.markResolvedRequested(index);
      this.lastSampleResolved = index;
      const w = this.streamWaiter;
      this.streamWaiter = null;
      this.notifyCapacityExact();
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
    const mustKeep =
      this.protectedIndexes.has(index) ||
      this.openedRequested.has(index) ||
      this.isNeeded(index) ||
      this.streamWaiter?.index === index;
    if (!this.streamReady.has(index) && this.streamReady.size >= this.reorderCap && !mustKeep) {
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
    const openedUnresolved = [...this.openedRequested].filter((i) => !this.isResolvedRequested(i));
    if (openedUnresolved.length > 0) {
      /* Keep exact-PTS ownership. An unmatched neighbor must not wipe PtsIndexMap / waiter. */
      return;
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
    this.lastOutputProgressTimestamp = frame.timestamp;
    this.notifyCapacityOutput();
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

  private rejectWaiters(err: Error, opts?: { keepOpenedOwnership?: boolean }): void {
    const pending: FrameWaiter[] = [];
    for (const q of this.waiters.values()) pending.push(...q);
    this.waiters.clear();
    for (const w of pending) w.reject(err);
    const keep = opts?.keepOpenedOwnership === true;
    if (this.streamWaiter) {
      const w = this.streamWaiter;
      const idx = w.index;
      this.streamWaiter = null;
      this.noteWaiterCleared(idx);
      if (keep) this.markRecoveryRebuilding([idx]);
      else {
        const waiterFate = isAfeError(err) && err.code === "AFE_ABORTED" ? "ABORTED" : "ERROR";
        this.noteOwnership(idx, waiterFate);
      }
      w.reject(err);
    }
    this.closeStreamFrames();
    const fate =
      isAfeError(err) && err.code === "AFE_ABORTED" ? "ABORTED" : "ERROR";
    if (keep) {
      this.streamPts.failPending("ABORTED");
      this.streamPts.clear();
    } else {
      this.streamPts.failPending(fate);
    }
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
