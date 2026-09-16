import { decoderConfigOf } from "./avc-config";
import { AfeError, abortedError, isAfeError, throwIfAborted } from "./errors";
import { AFE_MAX_REORDER_READY, PtsIndexMap } from "./frame-match";
import { afePerfAdd, afePerfCount, afePerfEnabled, afePerfMarkDecoded, afePerfMax, afePerfProbeInstalled } from "./perf";
import {
  type ChunkFingerprint,
  type DecoderConfigFingerprint,
  fingerprintDecoderConfig,
  fingerprintSampleChunk,
  firstChunkAfterRecreateCheck,
  expectedRecoveryChunks,
  recoveryMatchesColdPrefix,
} from "./parity";
import {
  AFE_DECODE_STALL_MS,
  AFE_FLUSH_WATCHDOG_MS,
  AFE_POST_RECREATE_OUTPUT_BUDGET_MS,
  AFE_SETTLE_DRAIN_MS,
  mustAdvanceTowardDependencyHorizon,
  mayBorrowHardDependencyCredits,
  mayLocalHorizonFinalFlush,
  currentTargetRequiredSample,
  postHorizonRequiredSample,
  hardDependencyCeiling,
  classifySampleRole,
  decodeQueueHighWater,
  decodeQueueLowWater,
  emptyStallSnapshot,
  formatStallMessage,
  hasFurtherUsefulInput,
  isTransactionComplete,
  lastRequiredDecodeSample,
  requestedEncodedInvariantHolds,
  mayFinalFlush,
  mayResumeDecode,
  maySubmitEncoded,
  nowMs,
  originFromStall,
  usefulInputExhausted,
  requestedPtsIsPending,
  streamLookaheadSamples,
  exactRequestIdentityHolds,
  mayGenuineFinalDrain,
  type AfeStallPhase,
  type AfeStallSnapshot,
  type PtsIdentityAction,
  type PtsIdentityEvent,
  type RequestOwnershipState,
  type SampleFate,
  type SampleRole,
  type SubmitPhaseTrace,
} from "./stall";
import { sampleDurationToChunkDurationUs, samplePtsToChunkTimestampUs } from "./timestamps";
import type { AfeMovie, AfeSample } from "./types";
import { earlierKeyframeOrigin, nextKeyframeAfter, sampleBytes } from "./mp4-reader";

type FrameWaiter = { resolve: (frame: VideoFrame) => void; reject: (e: Error) => void };

type OpenedRequestOwnership = {
  index: number;
  ptsUs: number | null;
  transitions: RequestOwnershipState[];
  waiterActive: boolean;
  /** Live: currently in PtsIndexMap / exact pending / ready. */
  ptsRegistered: boolean;
  /** Sticky: inserted at least once. Not live identity. */
  ptsEverRegistered: boolean;
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
  /** Cleared on recreate so AFE-11 can flush again; dump bit stays sticky. */
  private finalFlushThisDecoder = false;
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
  private gopKeyframeStart: number | null = null;
  private frozenAfterRecreate = false;
  private earlierKeyframeRecovered = false;
  private earlierKeyframeRecoverCount = 0;
  private windowPaused = false;
  private coldConfig: DecoderConfigFingerprint | null = null;
  private recoveryConfig: DecoderConfigFingerprint | null = null;
  private lastConfig: DecoderConfigFingerprint | null = null;
  private coldChunks: ChunkFingerprint[] = [];
  private recoveryChunks: ChunkFingerprint[] = [];
  private awaitingFirstAfterRecreate = false;
  private firstSubmittedAfterRecreate: number | null = null;
  private firstSubmittedAfterRecreateKey: boolean | null = null;
  private firstSubmittedAfterRecreatePts: number | null = null;
  private firstSubmittedAfterRecreateDts: number | null = null;
  private postRecreateSubmitted = 0;
  private postRecreateOutputs = 0;
  private postRecreateLastDecodedTs: number | null = null;
  private postRecreateOutputTimestamps: number[] = [];
  private packetParityEqual: boolean | null = null;
  private packetParityCompared = 0;
  private packetParityMismatchIndex: number | null = null;
  private packetParityMismatchField: string | null = null;
  private readonly identityEvents: PtsIdentityEvent[] = [];
  private readonly outputTimestamps: number[] = [];
  private readonly tailOutputTimestamps: number[] = [];
  private targetPtsUs: number | null = null;
  private targetPtsOutputCount = 0;
  private targetPtsLastSeenTs: number | null = null;
  private tailDrainReplayed = false;
  /**
   * AFE-18: HARD computed from remaining shrinks as we submit, while the
   * queue grows — they meet before the live local horizon. Freeze the
   * ceiling for this borrow episode so SOFT+min(remaining_at_stall, L+B)
   * credits can actually be spent.
   */
  private hardBorrowCeiling: number | null = null;

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

  /** Derived HIGH_WATER — tight after recreate, RECOVERY_FILL first fill. */
  get decodeQueueHighWater(): number {
    return decodeQueueHighWater(this.movie.maxReorderSamples, this.prefetchHint, {
      afterRecreate: this.recreateCount >= 1,
    });
  }

  /** Resume target after HIGH_WATER pause. Always < HIGH_WATER. */
  get decodeQueueLowWater(): number {
    return decodeQueueLowWater(this.movie.maxReorderSamples, this.prefetchHint, {
      afterRecreate: this.recreateCount >= 1,
    });
  }

  /** AFE-17: SOFT_HIGH_WATER — normal AFE-14/16 threshold. */
  get softHighWater(): number {
    return this.decodeQueueHighWater;
  }

  /** Formula LOCAL horizon (AFE-17) — lastRequired(requested), capped by lastRequired. */
  formulaTargetRequiredFor(requested: number): number {
    return currentTargetRequiredSample({
      requested,
      maxReorderSamples: this.movie.maxReorderSamples,
      prefetch: this.prefetchHint,
      sampleCount: this.movie.sampleCount,
      lastRequiredDecodeSample: this.lastRequiredSample ?? undefined,
      nextRefOrGop: nextKeyframeAfter(this.movie, requested),
    });
  }

  /**
   * LIVE local horizon: formula, or AFE-18 one-window extension when the
   * formula was submitted and lastDecoded is still behind the exact PTS.
   */
  currentTargetRequiredFor(requested: number): number {
    const formula = this.formulaTargetRequiredFor(requested);
    const rec = this.ownership.get(requested);
    if (rec?.recoveryRebuilding) return formula;
    const targetPts = rec?.ptsUs ?? this.targetPtsUs;
    return postHorizonRequiredSample({
      requested,
      currentTargetRequiredSample: formula,
      lastSubmittedSample: this.lastSubmittedSample,
      lastRequiredDecodeSample: this.lastRequiredSample ?? formula,
      maxReorderSamples: this.movie.maxReorderSamples,
      prefetch: this.prefetchHint,
      sampleCount: this.movie.sampleCount,
      exactReady: this.streamReady.has(requested),
      targetPtsSeen:
        targetPts != null &&
        (this.outputTimestamps.includes(targetPts) || this.lastVideoFrameTimestamp === targetPts),
      lastDecodedTimestamp: this.lastVideoFrameTimestamp,
      targetPtsUs: targetPts,
    });
  }

  /** Derived HARD_DEPENDENCY_CEILING for the live local target. */
  hardDependencyCeilingFor(requested: number): number {
    return hardDependencyCeiling({
      softHighWater: this.decodeQueueHighWater,
      lastSubmittedSample: this.lastSubmittedSample,
      currentTargetRequiredSample: this.currentTargetRequiredFor(requested),
      maxReorderSamples: this.movie.maxReorderSamples,
      prefetch: this.prefetchHint,
    });
  }

  /** Effective HARD: frozen borrow-episode ceiling wins over a shrinking remaining. */
  effectiveHardCeilingFor(requested: number): number {
    const computed = this.hardDependencyCeilingFor(requested);
    if (this.hardBorrowCeiling == null) return computed;
    return Math.max(this.hardBorrowCeiling, computed);
  }

  /**
   * Premature / leftover FINAL_FLUSH while the live local horizon is still
   * unsubmitted (QA dump: FINAL_FLUSH yes at lastSubmitted 67 after live
   * target extends to 77, or stale flags from the previous clip on the
   * same file). Not a mid-run pressure flush — just forget the stale arm
   * so this request can borrow, then drain once the live horizon is in.
   */
  /**
   * AFE-19: requested sample + formula deps are already submitted, exact PTS
   * still missing, hardware still holding. One ownership-retaining drain —
   * not a mid-run pressure flush, not a flood to lastRequired 102.
   * After recreate, require real output (postRecreateOutputs >= lookahead) so
   * AFE-13 freeze-after-4-emits still stalls without hanging on flush.
   */
  mayFormulaHorizonDrain(requested: number): boolean {
    const formula = this.formulaTargetRequiredFor(requested);
    const targetPts = this.ownership.get(requested)?.ptsUs ?? this.targetPtsUs;
    const local = mayLocalHorizonFinalFlush({
      unresolvedRequestedVideoFrames: this.unresolvedRequestedCount(),
      lastSubmittedSample: this.lastSubmittedSample,
      currentTargetRequiredSample: formula,
      formulaTargetRequiredSample: formula,
      exactReady: this.streamReady.has(requested),
      targetPtsSeen:
        targetPts != null &&
        (this.outputTimestamps.includes(targetPts) || this.lastVideoFrameTimestamp === targetPts),
      decodeQueueSize: this.decodeQueueSize,
      outputProgressed: false,
      lastDecodedTimestamp: this.lastVideoFrameTimestamp,
      targetPtsUs: targetPts,
      recoveryRebuilding: this.ownership.get(requested)?.recoveryRebuilding === true,
      transactionComplete: false,
    });
    if (local) {
      if (this.recreateCount < 1) return true;
      const look = streamLookaheadSamples(this.movie.maxReorderSamples, this.prefetchHint);
      return this.postRecreateOutputs >= look;
    }
    /* Variant b0: after VIS→video recreate the first keyframe is submitted
     * (formula in, queue held) but WebCodecs emits nothing — lastDecoded stays
     * null so the helper refuses. One drain; AFE-13 freeze-after-N-emits has
     * lastDecoded set and is still gated by postRecreateOutputs. */
    if (this.recreateCount < 1) return false;
    if (this.lastVideoFrameTimestamp != null) return false;
    if (this.decodeQueueSize <= 0) return false;
    if (this.streamReady.has(requested)) return false;
    if (this.unresolvedRequestedCount() <= 0) return false;
    if ((this.lastSubmittedSample ?? -1) < formula) return false;
    return this.firstSubmittedAfterRecreateKey === true;
  }

  releaseStaleFinalFlushIfLiveHorizonOpen(requested: number): void {
    const live = this.currentTargetRequiredFor(requested);
    if ((this.lastSubmittedSample ?? -1) >= live) return;
    if (!this.finalFlushAttempted && !this.finalFlushArmed && !this.finalFlushThisDecoder) return;
    this.finalFlushArmed = false;
    this.finalFlushThisDecoder = false;
    this.tailDrainReplayed = false;
  }

  /** True when this decoder instance already consumed its one FINAL_FLUSH. */
  get finalFlushConsumedThisDecoder(): boolean {
    return this.finalFlushThisDecoder;
  }

  get coldStartChunks(): readonly ChunkFingerprint[] {
    return this.coldChunks;
  }

  get recoveryStartChunks(): readonly ChunkFingerprint[] {
    return this.recoveryChunks;
  }

  get lastDecoderConfigFingerprint(): DecoderConfigFingerprint | null {
    return this.lastConfig;
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

  get currentGopKeyframeStart(): number | null {
    return this.gopKeyframeStart;
  }

  setGopKeyframeStart(origin: number | null): void {
    this.gopKeyframeStart = origin;
  }

  get earlierKeyframeRecoverUsed(): boolean {
    return this.earlierKeyframeRecovered;
  }

  noteEarlierKeyframeRecover(): void {
    this.earlierKeyframeRecovered = true;
    this.earlierKeyframeRecoverCount += 1;
  }

  isFrozenAtHighWaterAfterRecreate(): boolean {
    if (this.recreateCount < 1) return false;
    if (this.unresolvedRequestedCount() <= 0) return false;
    if (this.decodeQueueSize < this.decodeQueueHighWater) return false;
    if (this.frozenAfterRecreate) return true;
    if (!this.noMoreSubmission && !this.backpressureBlocked) return false;
    return this.lastVideoFrameTimestamp === this.lastDecodedAtSubmit;
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
        ptsEverRegistered: false,
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
    const rec = this.ensureOwnership(index, ptsUs);
    if (ptsUs != null) {
      rec.ptsUs = ptsUs;
      this.targetPtsUs = ptsUs;
    }
    this.noteIdentity(index, "OPEN_REQUEST", rec.ptsUs);
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

  identityTrace(index?: number): PtsIdentityEvent[] {
    if (index == null) return [...this.identityEvents];
    return this.identityEvents.filter((e) => e.index === index);
  }

  tailOutputTrace(): number[] {
    return [...this.tailOutputTimestamps];
  }

  outputTrace(): number[] {
    return [...this.outputTimestamps];
  }

  hasTargetPtsBeenSeen(ptsUs?: number | null): boolean {
    const pts = ptsUs ?? this.targetPtsUs;
    return pts != null && this.targetPtsOutputCount > 0 && this.targetPtsLastSeenTs === pts
      ? true
      : pts != null && this.outputTimestamps.includes(pts);
  }

  ptsEverRegisteredFor(index: number): boolean {
    return this.ownership.get(index)?.ptsEverRegistered === true;
  }

  ptsCurrentlyRegisteredFor(index: number): boolean {
    return this.streamPts.hasIndex(index) || this.streamReady.has(index);
  }

  /**
   * Re-bind live exact identity. FINAL_FLUSH_ARMED is not a substitute.
   * Until RESOLVED/ERROR/ABORT the request must sit in PtsIndexMap,
   * streamReady, an exact waiter, or an active recovery rebuild.
   */
  /** Test hook: inject a WebCodecs output with an exact timestamp. */
  deliverOutputForTest(timestamp: number): void {
    const Frame = (globalThis as unknown as { VideoFrame: new (ts: number) => VideoFrame }).VideoFrame;
    this.onOutput(new Frame(timestamp), this.currentTransactionId);
  }

  /** Test / audit hook: drop live map identity without resolving the request. */
  dropLivePtsIdentity(index: number): boolean {
    const rec = this.ownership.get(index);
    const pts = rec?.ptsUs ?? null;
    const left = this.streamPts.deleteIndex(index);
    if (left) this.noteIdentity(index, "PTS_LEAVE_DELETE", pts);
    this.syncPtsCurrent(index);
    return left;
  }

  retainExactIdentity(index: number, ptsUs?: number | null): boolean {
    if (!this.openedRequested.has(index) || this.isResolvedRequested(index)) return false;
    const ok = this.confirmPtsRegistered(index, ptsUs);
    this.noteIdentity(index, "RETAIN", ptsUs ?? this.ownership.get(index)?.ptsUs ?? null);
    return ok;
  }

  private recordOutputTimestamp(timestamp: number): void {
    if (this.outputTimestamps.length < 48) this.outputTimestamps.push(timestamp);
    else {
      this.outputTimestamps.shift();
      this.outputTimestamps.push(timestamp);
    }
    if (this.finalFlushArmed || this.stallPhase === "FINAL_FLUSH") {
      if (this.tailOutputTimestamps.length < 24) this.tailOutputTimestamps.push(timestamp);
    }
    if (this.targetPtsUs != null && timestamp === this.targetPtsUs) {
      this.targetPtsOutputCount += 1;
      this.targetPtsLastSeenTs = timestamp;
    } else {
      const opened = this.openedUnresolvedByPts(timestamp);
      if (opened != null) {
        this.targetPtsUs = timestamp;
        this.targetPtsOutputCount += 1;
        this.targetPtsLastSeenTs = timestamp;
      }
    }
  }

  private noteIdentity(index: number, action: PtsIdentityAction, ptsUs?: number | null, fate?: SampleFate): void {
    const rec = this.ownership.get(index);
    const pts = ptsUs ?? rec?.ptsUs ?? null;
    this.identityEvents.push({
      index,
      ptsUs: pts,
      action,
      fate: fate ?? this.streamPts.fateOf(index),
      streamPtsPending: this.streamPts.pendingCount(),
      streamReady: this.streamReady.has(index),
      waiter: this.streamWaiter?.index === index,
    });
    if (this.identityEvents.length > 64) this.identityEvents.shift();
  }

  private syncPtsCurrent(index: number): void {
    const rec = this.ownership.get(index);
    if (!rec) return;
    rec.ptsRegistered = this.ptsCurrentlyRegisteredFor(index);
    if (rec.ptsRegistered) rec.ptsEverRegistered = true;
  }

  private openedUnresolvedByPts(timestamp: number): number | undefined {
    for (const index of this.openedRequested) {
      if (this.isResolvedRequested(index)) continue;
      const rec = this.ownership.get(index);
      const pts = rec?.ptsUs ?? (this.movie.samples[index] ? this.chunkTimestampUs(this.movie.samples[index]!) : null);
      if (pts === timestamp) return index;
    }
    return undefined;
  }

  private mustKeepOpened(index: number): boolean {
    if (this.protectedIndexes.has(index)) return true;
    if (this.openedRequested.has(index) && !this.isResolvedRequested(index)) return true;
    if (this.streamWaiter?.index === index) return true;
    return false;
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
    /* Current attempt — not a leftover planned slice (AFE-17 provenance). */
    this.pumpSliceStart = submittedFrom;
    this.pumpSliceEnd = this.lastSubmittedSample ?? submittedFrom;
  }

  endSubmitPhase(): void {
    const open = this.openSubmitPhase;
    if (!open) return;
    open.submittedTo = this.lastSubmittedSample;
    open.decodeQueueEnd = this.decodeQueueSize;
    open.lastDecodedEnd = this.lastVideoFrameTimestamp;
    open.outputProgressed = open.lastDecodedEnd !== open.lastDecodedStart;
    this.pumpSliceStart = open.submittedFrom;
    this.pumpSliceEnd = open.submittedTo;
    this.submitPhaseTraces.push(open);
    if (this.submitPhaseTraces.length > 16) this.submitPhaseTraces.shift();
    this.openSubmitPhase = null;
  }

  /**
   * Pause when decodeQueueSize >= HIGH_WATER and there is no output progress.
   * AFE-14: resume only at LOW_WATER or exact-PTS ready — not on every dequeue
   * after lastRequired is fully submitted.
   * AFE-16: if exact frame is not ready, useful input remains,
   * lastSubmitted < lastRequired, and queue < HIGH, do not block solely
   * because queue > LOW_WATER. Submitting the requested sample does not
   * close H.264 reorder / B-frame dependencies. Queued input does not
   * necessarily produce further output / the requested PTS.
   * AFE-17/18: if the queue is already at SOFT HIGH and the
   * LOCAL target horizon is still unsubmitted, borrow bounded credits up
   * to HARD_DEPENDENCY_CEILING. Do not use lastRequired=140 as a flood.
   * Once the local horizon is submitted, emergency credits stop.
   * If HARD is reached with no output progress: no more submit (recover/stall).
   * No busy loop. No arbitrary sleep. No mid-run flush.
   *
   * Returns false when the caller must not submit more. Before the first
   * recreate, that is a stop-for-STEP-C signal (do not 3s-stall). After
   * recreate, a still-stuck HIGH_WATER / HARD queue returns false after a
   * short output-progress budget. gopStart==0 does not re-loop AFE-13 escape.
   */
  async waitForDecodeCapacity(
    signal?: AbortSignal,
    opts?: { budgetEnd?: number; requested?: number },
  ): Promise<boolean> {
    throwIfAborted(signal);
    const high = this.decodeQueueHighWater;
    const low = this.decodeQueueLowWater;
    this.noteQueuePeak();
    const requested = opts?.requested;
    const exactReady = requested != null && this.streamReady.has(requested);
    if (exactReady) {
      this.windowPaused = false;
      this.noMoreSubmission = false;
      this.backpressureBlocked = false;
      this.frozenAfterRecreate = false;
      return true;
    }
    if (requested != null) this.ensureRebuildOwnership(requested);
    const outputProgressed = this.lastVideoFrameTimestamp !== this.lastDecodedAtSubmit;
    const mustAdvance = this.dependencyHorizonAdvance(requested, false);
    const mustBorrow = this.hardDependencyBorrow(requested, false, outputProgressed);
    const hard = requested != null ? this.effectiveHardCeilingFor(requested) : high;
    if (
      mayResumeDecode({
        decodeQueueSize: this.decodeQueueSize,
        highWater: high,
        lowWater: low,
        exactReady: false,
        paused: this.windowPaused,
        mustAdvanceTowardDependencyHorizon: mustAdvance,
        mustBorrowHardDependencyCredits: mustBorrow,
        hardDependencyCeiling: hard,
      }) &&
      maySubmitEncoded({
        decodeQueueSize: this.decodeQueueSize,
        highWater: high,
        outputProgressed,
        lowWater: low,
        paused: this.windowPaused,
        exactReady: false,
        mustAdvanceTowardDependencyHorizon: mustAdvance,
        mustBorrowHardDependencyCredits: mustBorrow,
        hardDependencyCeiling: hard,
      })
    ) {
      this.noMoreSubmission = false;
      this.backpressureBlocked = false;
      this.frozenAfterRecreate = false;
      return true;
    }
    this.windowPaused = true;
    this.noMoreSubmission = true;
    this.backpressureWaitCount += 1;
    this.backpressureBlocked = true;
    if (this.openSubmitPhase) this.openSubmitPhase.pausedForCapacity = true;
    if (this.recreateCount === 0) return false;
    const tsAtPause = this.lastVideoFrameTimestamp;
    const short = nowMs() + AFE_POST_RECREATE_OUTPUT_BUDGET_MS;
    const deadline = Math.min(short, opts?.budgetEnd ?? short);
    const dec = this.decoder;
    const resumeArgs = (ready: boolean) => {
      const progressed = this.lastVideoFrameTimestamp !== this.lastDecodedAtSubmit;
      return {
        decodeQueueSize: this.decodeQueueSize,
        highWater: high,
        lowWater: low,
        exactReady: ready,
        paused: true as const,
        mustAdvanceTowardDependencyHorizon: this.dependencyHorizonAdvance(requested, ready),
        mustBorrowHardDependencyCredits: this.hardDependencyBorrow(requested, ready, progressed),
        hardDependencyCeiling: requested != null ? this.effectiveHardCeilingFor(requested) : high,
      };
    };
    while (!mayResumeDecode(resumeArgs(requested != null && this.streamReady.has(requested)))) {
      throwIfAborted(signal);
      if (requested != null && this.streamReady.has(requested)) {
        this.windowPaused = false;
        this.backpressureBlocked = false;
        this.noMoreSubmission = false;
        this.frozenAfterRecreate = false;
        return true;
      }
      if (this.lastError) throw this.lastError;
      const remain = deadline - nowMs();
      if (remain <= 0) {
        const ceiling = requested != null ? this.effectiveHardCeilingFor(requested) : high;
        if (
          this.lastVideoFrameTimestamp === tsAtPause &&
          this.decodeQueueSize >= high
        ) {
          this.noMoreSubmission = true;
          this.frozenAfterRecreate = this.decodeQueueSize >= ceiling || this.decodeQueueSize >= high;
          return false;
        }
        const resume = mayResumeDecode(resumeArgs(false));
        this.backpressureBlocked = !resume;
        if (resume) this.windowPaused = false;
        return resume;
      }
      const reason = await this.waitCapacitySignal(dec, signal, remain);
      if (reason === "exact" || (requested != null && this.streamReady.has(requested))) {
        this.windowPaused = false;
        this.backpressureBlocked = false;
        this.noMoreSubmission = false;
        this.frozenAfterRecreate = false;
        return true;
      }
      if (mayResumeDecode(resumeArgs(false))) {
        this.windowPaused = false;
        this.noMoreSubmission = false;
        this.frozenAfterRecreate = false;
        this.backpressureBlocked = false;
        return true;
      }
    }
    this.windowPaused = false;
    this.backpressureBlocked = false;
    this.noMoreSubmission = false;
    this.frozenAfterRecreate = false;
    return true;
  }

  /**
   * AFE-16: exact frame unresolved, lastSubmitted still behind lastRequired,
   * unused HIGH_WATER credits, useful input remains — do not wait on LOW_WATER.
   * Horizon is lastRequiredDecodeSample, not the requested sample index.
   */
  private dependencyHorizonAdvance(requested: number | undefined, exactReady: boolean): boolean {
    if (requested == null || exactReady) return false;
    const lastSubmitted = this.lastSubmittedSample ?? -1;
    const lastRequired = this.lastRequiredSample ?? requested;
    return mustAdvanceTowardDependencyHorizon({
      lastSubmittedSample: this.lastSubmittedSample,
      lastRequiredDecodeSample: lastRequired,
      decodeQueueSize: this.decodeQueueSize,
      highWater: this.decodeQueueHighWater,
      exactReady,
      usefulInputRemains: hasFurtherUsefulInput({
        nextDecode: lastSubmitted + 1,
        sampleCount: this.movie.sampleCount,
        lastRequiredDecodeSample: lastRequired,
      }),
    });
  }

  /**
   * AFE-17/18: borrow bounded HARD credits after recreate while the LIVE
   * local target is unsubmitted, only at/above SOFT, only with no output
   * progress. First-fill stays on SOFT HIGH (AFE-12/16). Stops once
   * currentTargetRequired is submitted or the frozen HARD is reached.
   */
  private hardDependencyBorrow(
    requested: number | undefined,
    exactReady: boolean,
    outputProgressed: boolean,
  ): boolean {
    if (requested == null || exactReady) {
      this.hardBorrowCeiling = null;
      return false;
    }
    if (this.recreateCount < 1) {
      this.hardBorrowCeiling = null;
      return false;
    }
    this.releaseStaleFinalFlushIfLiveHorizonOpen(requested);
    const currentTarget = this.currentTargetRequiredFor(requested);
    const computed = this.hardDependencyCeilingFor(requested);
    const submitted = this.lastSubmittedSample ?? -1;
    if (submitted >= currentTarget) {
      this.hardBorrowCeiling = null;
      return false;
    }
    const hard = Math.max(computed, this.hardBorrowCeiling ?? computed);
    const borrow = mayBorrowHardDependencyCredits({
      exactReady,
      usefulInputRemains: hasFurtherUsefulInput({
        nextDecode: submitted + 1,
        sampleCount: this.movie.sampleCount,
        lastRequiredDecodeSample: currentTarget,
      }),
      currentTargetRequiredSample: currentTarget,
      lastSubmittedSample: this.lastSubmittedSample,
      outputProgressed,
      decodeQueueSize: this.decodeQueueSize,
      softHighWater: this.decodeQueueHighWater,
      hardDependencyCeiling: hard,
    });
    if (borrow) this.hardBorrowCeiling = Math.max(this.hardBorrowCeiling ?? 0, computed);
    else if (this.decodeQueueSize >= hard) this.hardBorrowCeiling = null;
    return borrow;
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
    this.finalFlushThisDecoder = true;
    this.stallPhase = "FINAL_FLUSH";
    const ids = indexes
      ? [...indexes]
      : [...this.openedRequested].filter((i) => !this.isResolvedRequested(i));
    for (const index of ids) {
      const rec = this.ensureOwnership(index);
      rec.recoveryRebuilding = false;
      this.retainExactIdentity(index, rec.ptsUs);
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

  /**
   * RECOVERY_REBUILDING must not sit with waiter null + ptsRegistered no.
   * Re-bind PTS immediately so ownership holds during the rebuild step.
   */
  private ensureRebuildOwnership(index: number): void {
    if (!this.openedRequested.has(index) || this.isResolvedRequested(index)) return;
    const rec = this.ensureOwnership(index);
    if (rec.ptsRegistered || this.streamWaiter?.index === index) return;
    if (rec.recoveryRebuilding || this.recreateCount > 0) {
      this.confirmPtsRegistered(index, rec.ptsUs);
    }
  }

  confirmPtsRegistered(index: number, ptsUs?: number | null): boolean {
    const sample = this.movie.samples[index];
    const pts = ptsUs ?? (sample ? this.chunkTimestampUs(sample) : this.ownership.get(index)?.ptsUs ?? null);
    const rec = this.ensureOwnership(index, pts);
    if (pts != null) rec.ptsUs = pts;
    if (this.streamReady.has(index) || this.isResolvedRequested(index)) {
      rec.ptsRegistered = true;
      rec.ptsEverRegistered = true;
      this.noteOwnership(index, "PTS_REGISTERED");
      return true;
    }
    if (pts != null && !this.streamPts.hasIndex(index)) {
      this.streamPts.push(pts, index);
      this.noteIdentity(index, "PTS_INSERT", pts);
    }
    rec.ptsRegistered = this.streamPts.hasIndex(index);
    if (rec.ptsRegistered) {
      rec.ptsEverRegistered = true;
      this.noteOwnership(index, "PTS_REGISTERED");
    }
    return rec.ptsRegistered;
  }

  assertOpenedOwnership(extra?: Partial<AfeStallSnapshot>): void {
    const unresolved = [...this.openedRequested].filter((i) => !this.isResolvedRequested(i));
    if (unresolved.length === 0) return;
    const waiter = this.streamWaiter?.index ?? null;
    const rebuilding = unresolved.some((i) => this.ownership.get(i)?.recoveryRebuilding);
    const live = unresolved.some((i) =>
      exactRequestIdentityHolds({
        unresolvedRequestedVideoFrames: 1,
        streamWaiterIndex: waiter === i ? waiter : this.streamWaiter?.index === i ? i : null,
        pendingPts: this.streamPts.hasIndex(i) ? this.streamPts.pendingTimestamps() : [],
        requestedPtsUs: this.ownership.get(i)?.ptsUs ?? extra?.requestedPtsUs ?? null,
        ptsCurrentlyRegistered: this.ptsCurrentlyRegisteredFor(i),
        streamReadyExact: this.streamReady.has(i),
        recoveryRebuilding: this.ownership.get(i)?.recoveryRebuilding === true,
      }),
    );
    if (
      live ||
      exactRequestIdentityHolds({
        unresolvedRequestedVideoFrames: unresolved.length,
        streamWaiterIndex: waiter,
        pendingPts: this.streamPts.pendingTimestamps(),
        requestedPtsUs: extra?.requestedPtsUs ?? this.ownership.get(unresolved[0]!)?.ptsUs ?? null,
        ptsCurrentlyRegistered: unresolved.some((i) => this.ptsCurrentlyRegisteredFor(i)),
        streamReadyExact: unresolved.some((i) => this.streamReady.has(i)),
        recoveryRebuilding: rebuilding,
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
    if (fields.gopKeyframeStart != null) this.gopKeyframeStart = fields.gopKeyframeStart;
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
    const ptsCurrently =
      extra?.ptsCurrentlyRegistered ??
      (focus != null
        ? this.ptsCurrentlyRegisteredFor(focus)
        : unresolvedRecs.some((i) => this.ptsCurrentlyRegisteredFor(i)));
    const ptsEver =
      extra?.ptsEverRegistered ??
      (focus != null
        ? rec?.ptsEverRegistered === true || ptsCurrently
        : unresolvedRecs.some((i) => this.ownership.get(i)?.ptsEverRegistered === true) || ptsCurrently);
    const ptsRegistered = extra?.ptsRegistered ?? ptsCurrently;
    const targetPts = extra?.targetPtsUs ?? extra?.requestedPtsUs ?? rec?.ptsUs ?? this.targetPtsUs;
    const targetSeen = extra?.targetPtsSeen ?? (targetPts != null && this.outputTimestamps.includes(targetPts));
    const identityHolds =
      extra?.exactIdentityHolds ??
      (focus != null
        ? exactRequestIdentityHolds({
            unresolvedRequestedVideoFrames: unresolved > 0 ? 1 : 0,
            streamWaiterIndex: waiter === focus ? waiter : null,
            pendingPts: this.streamPts.pendingTimestamps(),
            requestedPtsUs: targetPts,
            ptsCurrentlyRegistered: ptsCurrently,
            streamReadyExact: this.streamReady.has(focus),
            recoveryRebuilding: rec?.recoveryRebuilding === true,
          })
        : exactRequestIdentityHolds({
            unresolvedRequestedVideoFrames: unresolved,
            streamWaiterIndex: waiter,
            pendingPts: this.streamPts.pendingTimestamps(),
            requestedPtsUs: targetPts,
            ptsCurrentlyRegistered: ptsCurrently,
            streamReadyExact: unresolvedRecs.some((i) => this.streamReady.has(i)),
            recoveryRebuilding: rebuilding,
          }));
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
    const traces = extra?.submitPhaseTraces ?? this.submitPhaseTraces;
    const lastPhase = this.openSubmitPhase ?? traces[traces.length - 1];
    const requestedSample =
      extra?.requestedSample ?? extra?.sourceSampleRequested ?? origin.sourceSampleRequested ?? focus ?? null;
    const currentTarget =
      extra?.currentTargetRequiredSample ??
      (requestedSample != null ? this.currentTargetRequiredFor(requestedSample) : null);
    const soft = extra?.softHighWater ?? extra?.decodeQueueHighWater ?? this.decodeQueueHighWater;
    const hard =
      extra?.hardDependencyCeiling ??
      (requestedSample != null ? this.effectiveHardCeilingFor(requestedSample) : soft);
    const submittedMinus =
      extra?.submittedMinusOutputs ??
      (this.recreateCount >= 1
        ? this.postRecreateSubmitted - this.postRecreateOutputs
        : (this.lastSubmittedSample ?? -1) + 1);
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
      pumpSliceStart:
        extra?.pumpSliceStart ??
        lastPhase?.submittedFrom ??
        this.pumpSliceStart,
      pumpSliceEnd:
        extra?.pumpSliceEnd ??
        lastPhase?.submittedTo ??
        this.pumpSliceEnd,
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
      gopKeyframeStart: extra?.gopKeyframeStart ?? this.gopKeyframeStart,
      frozenAtHighWater: extra?.frozenAtHighWater ?? this.isFrozenAtHighWaterAfterRecreate(),
      earlierKeyframeRecovered: extra?.earlierKeyframeRecovered ?? this.earlierKeyframeRecovered,
      decodeQueueLowWater: extra?.decodeQueueLowWater ?? this.decodeQueueLowWater,
      earlierKeyframeAvailable:
        extra?.earlierKeyframeAvailable ?? this.earlierKeyframeIsAvailable(),
      firstSubmittedAfterRecreate:
        extra?.firstSubmittedAfterRecreate ?? this.firstSubmittedAfterRecreate,
      firstSubmittedAfterRecreateKey:
        extra?.firstSubmittedAfterRecreateKey ?? this.firstSubmittedAfterRecreateKey,
      firstSubmittedAfterRecreatePts:
        extra?.firstSubmittedAfterRecreatePts ?? this.firstSubmittedAfterRecreatePts,
      firstSubmittedAfterRecreateDts:
        extra?.firstSubmittedAfterRecreateDts ?? this.firstSubmittedAfterRecreateDts,
      packetParity: extra?.packetParity ?? this.packetParityEqual,
      packetParityCompared: extra?.packetParityCompared ?? this.packetParityCompared,
      packetParityMismatchIndex:
        extra?.packetParityMismatchIndex ?? this.packetParityMismatchIndex,
      packetParityMismatchField:
        extra?.packetParityMismatchField ?? this.packetParityMismatchField,
      configParity: extra?.configParity ?? this.configParityValue(),
      configParityHashCold: extra?.configParityHashCold ?? this.coldConfig?.hash ?? null,
      configParityHashRecovery:
        extra?.configParityHashRecovery ?? this.recoveryConfig?.hash ?? null,
      postRecreateOutputTimestamps:
        extra?.postRecreateOutputTimestamps ?? [...this.postRecreateOutputTimestamps],
      postRecreateSubmitted: extra?.postRecreateSubmitted ?? this.postRecreateSubmitted,
      postRecreateOutputs: extra?.postRecreateOutputs ?? this.postRecreateOutputs,
      postRecreateLastDecodedTs:
        extra?.postRecreateLastDecodedTs ?? this.postRecreateLastDecodedTs,
      ptsEverRegistered: extra?.ptsEverRegistered ?? ptsEver,
      ptsCurrentlyRegistered: extra?.ptsCurrentlyRegistered ?? ptsCurrently,
      targetPtsUs: extra?.targetPtsUs ?? targetPts,
      targetPtsSeen: extra?.targetPtsSeen ?? targetSeen,
      targetPtsOutputCount: extra?.targetPtsOutputCount ?? this.targetPtsOutputCount,
      targetPtsLastSeenTs: extra?.targetPtsLastSeenTs ?? this.targetPtsLastSeenTs,
      tailOutputTimestamps: extra?.tailOutputTimestamps ?? [...this.tailOutputTimestamps],
      tailOutputCount: extra?.tailOutputCount ?? this.tailOutputTimestamps.length,
      exactIdentityHolds: extra?.exactIdentityHolds ?? identityHolds,
      requestedSample,
      currentTargetRequiredSample: currentTarget,
      formulaTargetRequiredSample:
        extra?.formulaTargetRequiredSample ??
        (requestedSample != null ? this.formulaTargetRequiredFor(requestedSample) : null),
      prefetch: extra?.prefetch ?? this.prefetchHint,
      softHighWater: soft,
      hardDependencyCeiling: hard,
      submittedMinusOutputs: submittedMinus,
    });
  }

  earlierKeyframeIsAvailable(): boolean {
    const gop = this.gopKeyframeStart;
    if (gop == null || gop <= 0) return false;
    return earlierKeyframeOrigin(this.movie, gop) != null;
  }

  private configParityValue(): boolean | null {
    if (this.recreateCount < 1 || !this.coldConfig || !this.recoveryConfig) return null;
    return this.coldConfig.hash === this.recoveryConfig.hash;
  }

  private noteConfigured(config: VideoDecoderConfig): void {
    const fp = fingerprintDecoderConfig(config);
    this.lastConfig = fp;
    if (this.recreateCount < 1) this.coldConfig = fp;
    else this.recoveryConfig = fp;
  }

  private refreshPacketParity(): void {
    if (this.recreateCount < 1 || this.recoveryChunks.length === 0) {
      this.packetParityEqual = null;
      return;
    }
    const origin = this.gopKeyframeStart ?? 0;
    const configHash =
      this.recoveryConfig?.hash ?? this.lastConfig?.hash ?? this.coldConfig?.hash ?? "";
    const expected = expectedRecoveryChunks(this.movie, origin, this.recoveryChunks.length, configHash);
    const vsExpected = recoveryMatchesColdPrefix(expected, this.recoveryChunks);
    let result = vsExpected;
    if (this.coldChunks.length > 0 && this.coldChunks[0]!.index === origin) {
      const vsCold = recoveryMatchesColdPrefix(this.coldChunks, this.recoveryChunks);
      if (!vsCold.equal) result = vsCold;
    }
    this.packetParityEqual = result.equal;
    this.packetParityCompared = result.compared;
    this.packetParityMismatchIndex = result.mismatchIndex;
    this.packetParityMismatchField = result.field;
  }

  private assertFirstChunkAfterRecreate(fp: ChunkFingerprint): void {
    const origin = this.gopKeyframeStart ?? 0;
    const check = firstChunkAfterRecreateCheck(this.movie, origin, fp);
    this.firstSubmittedAfterRecreate = fp.index;
    this.firstSubmittedAfterRecreateKey = fp.key;
    this.firstSubmittedAfterRecreatePts = fp.ptsUs;
    this.firstSubmittedAfterRecreateDts = fp.dtsUs;
    this.awaitingFirstAfterRecreate = false;
    if (check.ok) return;
    throw new AfeError(
      "AFE_DECODE_FAILED",
      `first chunk after recreate invalid: ${check.reason}; gopStart ${check.gopStart} sample ${fp.index} key ${fp.key} PTS ${fp.ptsUs} DTS ${fp.dtsUs} expected PTS ${check.expectedPtsUs} DTS ${check.expectedDtsUs}`,
      false,
    );
  }

  private assertConfigParity(): void {
    if (this.recreateCount < 1 || !this.coldConfig || !this.recoveryConfig) return;
    if (this.coldConfig.hash === this.recoveryConfig.hash) return;
    throw new AfeError(
      "AFE_DECODE_FAILED",
      `config parity mismatch: cold ${this.coldConfig.hash} != recovery ${this.recoveryConfig.hash}`,
      false,
    );
  }

  private beginPostRecreateTrace(): void {
    this.awaitingFirstAfterRecreate = true;
    this.firstSubmittedAfterRecreate = null;
    this.firstSubmittedAfterRecreateKey = null;
    this.firstSubmittedAfterRecreatePts = null;
    this.firstSubmittedAfterRecreateDts = null;
    this.postRecreateSubmitted = 0;
    this.postRecreateOutputs = 0;
    this.postRecreateLastDecodedTs = null;
    this.postRecreateOutputTimestamps = [];
    this.recoveryChunks = [];
    this.packetParityEqual = null;
    this.packetParityCompared = 0;
    this.packetParityMismatchIndex = null;
    this.packetParityMismatchField = null;
    this.windowPaused = false;
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
      this.noteConfigured(config);
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
        const resetConfig = decoderConfigOf(this.movie.avc);
        this.decoder.configure(resetConfig);
        this.needsKeyframe = true;
        this.noteConfigured(resetConfig);
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
    this.pumpSliceStart = null;
    this.pumpSliceEnd = null;
    this.lastVideoFrameTimestamp = null;
    this.lastDecodedAtSubmit = null;
    this.submitsWithoutOutputProgress = 0;
    this.backpressureBlocked = false;
    this.noMoreSubmission = false;
    this.frozenAfterRecreate = false;
    this.finalFlushArmed = false;
    this.finalFlushThisDecoder = false;
    this.tailDrainReplayed = false;
    this.hardBorrowCeiling = null;
    this.beginPostRecreateTrace();
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
    if (!bounds?.keepResolved) {
      this.identityEvents.length = 0;
      this.outputTimestamps.length = 0;
      this.tailOutputTimestamps.length = 0;
      this.targetPtsUs = null;
      this.targetPtsOutputCount = 0;
      this.targetPtsLastSeenTs = null;
      this.tailDrainReplayed = false;
    }
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
    this.pumpSliceStart = null;
    this.pumpSliceEnd = null;
    this.frozenAfterRecreate = false;
    this.windowPaused = false;
    this.finalFlushArmed = false;
    this.finalFlushThisDecoder = false;
    this.tailDrainReplayed = false;
    this.hardBorrowCeiling = null;
    if (!bounds?.keepResolved) {
      this.finalFlushAttempted = false;
      this.gopKeyframeStart = null;
      this.earlierKeyframeRecovered = false;
      this.earlierKeyframeRecoverCount = 0;
      this.coldChunks = [];
      this.recoveryChunks = [];
      this.packetParityEqual = null;
      this.packetParityCompared = 0;
      this.packetParityMismatchIndex = null;
      this.packetParityMismatchField = null;
    }
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
        if (this.openedRequested.has(index) && !this.isResolvedRequested(index)) {
          this.retainExactIdentity(index, rec?.ptsUs);
        }
        const live = exactRequestIdentityHolds({
          unresolvedRequestedVideoFrames: 1,
          streamWaiterIndex: null,
          pendingPts: this.streamPts.pendingTimestamps(),
          requestedPtsUs: rec?.ptsUs ?? extra?.requestedPtsUs ?? null,
          ptsCurrentlyRegistered: this.ptsCurrentlyRegisteredFor(index),
          streamReadyExact: this.streamReady.has(index),
          recoveryRebuilding: rec?.recoveryRebuilding === true,
        });
        if (this.openedRequested.has(index) && !this.isResolvedRequested(index) && !live) {
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
    const configHash = this.lastConfig?.hash ?? fingerprintDecoderConfig(decoderConfigOf(this.movie.avc)).hash;
    const fp = fingerprintSampleChunk(this.movie, sample, configHash);
    if (this.recreateCount >= 1) this.assertConfigParity();
    if (this.awaitingFirstAfterRecreate) {
      this.assertFirstChunkAfterRecreate(fp);
    }
    if (this.recreateCount < 1) this.coldChunks.push(fp);
    else {
      this.recoveryChunks.push(fp);
      this.postRecreateSubmitted += 1;
      this.refreshPacketParity();
      if (this.packetParityEqual === false) {
        throw new AfeError(
          "AFE_DECODE_FAILED",
          `packet parity mismatch at ${this.packetParityMismatchIndex}:${this.packetParityMismatchField ?? "?"}; ColdStartChunk(N) != RecoveryChunk(N)`,
          false,
        );
      }
    }
    const { timestamp, chunk } = this.makeChunk(sample);
    const role = this.classifySubmitted(sample.index);
    this.sampleRoles.set(sample.index, role);
    if (role === "SPECULATIVE") this.speculativeSubmitted += 1;
    if (role === "REQUESTED") this.protectSample(sample.index);
    this.streamPts.push(timestamp, sample.index);
    this.noteIdentity(sample.index, "PTS_INSERT", timestamp);
    this.lastSubmittedSample = sample.index;
    if (this.openSubmitPhase) {
      this.pumpSliceStart = this.openSubmitPhase.submittedFrom;
      this.pumpSliceEnd = sample.index;
    }
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
    for (const index of [...this.openedRequested].filter((i) => !this.isResolvedRequested(i))) {
      this.retainExactIdentity(index);
    }
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
    if (this.finalFlushArmed) await this.drainHeldTail(signal);
  }

  /**
   * CASE B: flush resolved but hardware still holds frames (human decodeQueue=2).
   * Wait for remaining outputs; optional ONE extra flush. Not GOP recreate.
   */
  private async drainHeldTail(signal?: AbortSignal): Promise<void> {
    const dec = this.decoder;
    if (!dec) return;
    const unresolved = () => this.unresolvedRequestedCount();
    const targetReady = () =>
      [...this.openedRequested].some((i) => !this.isResolvedRequested(i) && this.streamReady.has(i));
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
    const waitStart = nowMs();
    while (
      dec.decodeQueueSize > 0 &&
      unresolved() > 0 &&
      !targetReady() &&
      nowMs() - waitStart < AFE_SETTLE_DRAIN_MS
    ) {
      throwIfAborted(signal);
      await waitDequeue();
    }
    const snap = this.snapshot();
    const focus = snap.requestedSample ?? snap.sourceSampleRequested;
    const localExhausted =
      focus != null &&
      (this.lastSubmittedSample ?? -1) >= this.currentTargetRequiredFor(focus);
    const needReplay =
      !this.tailDrainReplayed &&
      mayGenuineFinalDrain({
        unresolvedRequestedVideoFrames: unresolved(),
        usefulInputExhausted: snap.usefulInputExhausted,
        finalFlushAttempted: true,
        targetPtsSeen: snap.targetPtsSeen,
        decodeQueueSize: this.decodeQueueSize,
        lastDecodedTimestamp: this.lastVideoFrameTimestamp,
        targetPtsUs: snap.targetPtsUs,
        recoveryRebuilding: snap.recoveryRebuilding,
        transactionComplete: snap.transactionComplete,
        localHorizonExhausted: localExhausted,
      });
    if (!needReplay) return;
    this.tailDrainReplayed = true;
    this.stallPhase = "FINAL_FLUSH";
    let flushTimer: ReturnType<typeof setTimeout> | undefined;
    this.flushCount += 1;
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
    const drainStart = nowMs();
    while (dec.decodeQueueSize > 0 && unresolved() > 0 && nowMs() - drainStart < AFE_SETTLE_DRAIN_MS) {
      throwIfAborted(signal);
      await waitDequeue();
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
    if (this.mustKeepOpened(index)) return true;
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
    this.noteIdentity(index, "READY", this.ownership.get(index)?.ptsUs ?? frame.timestamp);
    this.syncPtsCurrent(index);
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
      for (const index of openedUnresolved) this.retainExactIdentity(index);
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
    this.frozenAfterRecreate = false;
    if (this.recreateCount > 0) {
      this.postRecreateOutputs += 1;
      this.postRecreateLastDecodedTs = frame.timestamp;
      if (this.postRecreateOutputTimestamps.length < 24) {
        this.postRecreateOutputTimestamps.push(frame.timestamp);
      }
    }
    this.notifyCapacityOutput();
    this.recordOutputTimestamp(frame.timestamp);
    if (this.streamMode) {
      const idx = this.matchStreamIndex(frame.timestamp);
      if (idx != null) {
        this.noteIdentity(idx, "PTS_LEAVE_TAKE_EXACT", frame.timestamp);
        this.syncPtsCurrent(idx);
        if (!this.isNeeded(idx) && !this.mustKeepOpened(idx)) {
          frame.close();
          this.streamPts.mark(idx, this.protectedIndexes.has(idx) ? "ERROR" : "DISCARDED_NOT_NEEDED");
          this.noteIdentity(idx, "FATE", frame.timestamp, this.protectedIndexes.has(idx) ? "ERROR" : "DISCARDED_NOT_NEEDED");
          return;
        }
        if (this.mustKeepOpened(idx) && !this.isNeeded(idx)) {
          /* CASE A bookkeeping: opened exact request must keep the frame. */
        }
        this.noteIdentity(idx, "RESOLVE_STREAM", frame.timestamp);
        this.resolveStream(idx, frame);
        return;
      }
      const rematch = this.openedUnresolvedByPts(frame.timestamp);
      if (rematch != null) {
        this.noteIdentity(rematch, "REMATCH_EXACT_PTS", frame.timestamp);
        this.resolveStream(rematch, frame);
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
