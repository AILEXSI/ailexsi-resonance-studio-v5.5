/**
 * AFE-05/07 — B-frame export stall diagnostics + recover-without-mid-run-flush.
 *
 * WebCodecs (especially WebView2 hardware decode) may hold frame N until
 * future decode-order samples N+k arrive. Waiting for N without submitting
 * N+k is a deadlock. Timeout is fail-closed, not the fix.
 *
 * AFE-06 Windows shape (do not guess): requested sample/PTS null, waiter
 * null, streamPts/Ready 0, decodeQueue 4, flushes 1. Mid-run flush cleared
 * tracking while the hardware queue still held frames. Flush is not a nudge.
 */

export const AFE_DECODE_STALL_MS = 3000;
/** Brief exact-PTS wait (STEP A / after STEP B). Not a flush timer. */
export const AFE_WAIT_EXACT_PTS_MS = 120;
/** @deprecated AFE-06 nudge delay — not used as a flush trigger. */
export const AFE_STALL_NUDGE_MS = AFE_WAIT_EXACT_PTS_MS;
/** @deprecated AFE-06 post-nudge wait — not used as a flush trigger. */
export const AFE_STALL_NUDGE_WAIT_MS = 250;
/** Cap queue-drain spin on the *tail* flush only. */
export const AFE_SETTLE_DRAIN_MS = 80;
/** Watchdog around the one allowed FINAL_FLUSH / DECODER_DRAIN. */
export const AFE_FLUSH_WATCHDOG_MS = AFE_DECODE_STALL_MS;
/**
 * After recreate, detect frozen HIGH_WATER without sitting the 3s stall budget.
 * One dequeue/output window — not a mystery timeout, not a flush timer.
 */
export const AFE_POST_RECREATE_OUTPUT_BUDGET_MS = 80;

/**
 * Hard ceiling for WebCodecs decodeQueue HIGH_WATER.
 * Windows AFE-12 flood was decodeQueue 125 — never approach that.
 */
export const AFE_DECODE_QUEUE_HIGH_WATER_CAP = 48;

/**
 * AFE-12 historical recovery-fill floor. AFE-14 does **not** use this as
 * HIGH_WATER — a 40-deep post-recreate window still dies on WebView2
 * (lastDecodedTs 458333, gopStart 0, no earlier I-frame). Kept so dumps
 * and AFE-12 tests can name the old floor. Not a PREFETCH bump.
 */
export const AFE_DECODE_QUEUE_RECOVERY_FILL = 40;

/**
 * Structural decode-window lookahead (AFE-05). Caps the HIGH_WATER
 * lookahead term. Not a global PREFETCH bump.
 */
export const AFE_DECODE_WINDOW_LOOKAHEAD = 6;

export type SampleFate = "PENDING" | "READY" | "RESOLVED" | "DISCARDED_NOT_NEEDED" | "ERROR" | "ABORTED";

/** Decode-order sample class for AFE-08 submit / cancel. */
export type SampleRole = "REQUESTED" | "REFERENCE_REQUIRED" | "SPECULATIVE";

/**
 * AFE-10 — opened VIDEO request ownership. Ledger-only (opened/unresolved)
 * is not enough: the request must own PTS tracking and/or an exact waiter
 * until RESOLVED / ERROR / ABORT.
 */
export type RequestOwnershipState =
  | "OPEN_REQUEST"
  | "PTS_REGISTERED"
  | "WAIT_INSTALLED"
  | "RECOVERY_START"
  | "RECOVERY_REBUILDING"
  | "WAIT_REINSTALLED"
  | "FINAL_FLUSH_ARMED"
  | "RESOLVED"
  | "ENCODED"
  | "ERROR"
  | "ABORTED"
  | "OWNERSHIP_LOST";

/** Compact exact-PTS identity event (AFE-15 lifecycle / takeExact audit). */
export type PtsIdentityAction =
  | "OPEN_REQUEST"
  | "PTS_INSERT"
  | "PTS_LEAVE_TAKE_EXACT"
  | "PTS_LEAVE_DELETE"
  | "PTS_LEAVE_CLEAR"
  | "REMATCH_EXACT_PTS"
  | "RESOLVE_STREAM"
  | "READY"
  | "RETAIN"
  | "FATE";

export type PtsIdentityEvent = {
  index: number;
  ptsUs: number | null;
  action: PtsIdentityAction;
  fate?: SampleFate;
  streamPtsPending: number;
  streamReady: boolean;
  waiter: boolean;
};

/** Requested VIDEO cannot be DISCARDED_NOT_NEEDED. */
export const REQUESTED_VIDEO_FATES: readonly SampleFate[] = ["READY", "RESOLVED", "ERROR", "ABORTED"];

export type AfeDumpPictureKind = "vis" | "video" | "black";

export type AfeStallPhase =
  | "WAIT_EXACT_PTS"
  | "PUMP_LOOKAHEAD"
  | "GOP_RECOVERY"
  | "FINAL_FLUSH"
  | "DECODER_DRAIN"
  | "RESET"
  | "TRANSACTION_END";

export type AfeStallSnapshot = {
  exportFrameIndex: number | null;
  exportTimestampSec: number | null;
  sourceClipId: string | null;
  sourceClipLabel: string | null;
  sourceUrlName: string | null;
  sourceInMs: number | null;
  sourceOutMs: number | null;
  timelineMs: number | null;
  pictureKind: AfeDumpPictureKind | null;
  fps: number | null;
  visFrames: number | null;
  afeFrames: number | null;
  blackFrames: number | null;
  videoFramesRequested: number | null;
  videoFramesDecoded: number | null;
  videoFramesEncoded: number | null;
  visFramesEncoded: number | null;
  blackFramesEncoded: number | null;
  sourceSampleRequested: number | null;
  requestedPtsUs: number | null;
  decodeStartSample: number | null;
  lastSubmittedSample: number | null;
  decodeQueueSize: number;
  streamPtsPending: number;
  streamReadySize: number;
  streamWaiterIndex: number | null;
  reorderCap: number;
  lastVideoFrameTimestamp: number | null;
  lastSampleResolved: number | null;
  decoderFlushCount: number;
  decoderResetCount: number;
  decoderRecreateCount: number;
  recoveryAttempts: number;
  encoderEncodeQueueSize: number | null;
  lastProgressUpdateMs: number | null;
  pendingPts: number[];
  readyIndexes: number[];
  lastDecodedTimestamp: number | null;
  gopKeyframeStart: number | null;
  stalledMs: number;
  lookahead: number;
  maxReorderSamples: number;
  stallPhase: AfeStallPhase | null;
  transactionId: number | null;
  originRequestedSample: number | null;
  originRequestedPts: number | null;
  originExportFrame: number | null;
  originTimelineMs: number | null;
  originClipId: string | null;
  originClipLabel: string | null;
  originSourceName: string | null;
  originPictureKind: AfeDumpPictureKind | null;
  lastRequestedSample: number | null;
  lastRequiredDecodeSample: number | null;
  speculativeSamplesSubmitted: number;
  cancelledSpeculativeSamples: number;
  decodeQueueBeforeCancel: number | null;
  decoderResetForTransactionEnd: boolean;
  /** Presentation samples the export actually asked for (not the planned run set). */
  openedRequestedVideoFrames: number;
  unresolvedRequestedVideoFrames: number;
  transactionComplete: boolean;
  pumpSliceStart: number | null;
  pumpSliceEnd: number | null;
  ptsRegistered: boolean;
  ownershipWaiterActive: boolean;
  ownershipRebuilt: boolean;
  recoveryRebuilding: boolean;
  ownershipState: RequestOwnershipState | null;
  finalFlushAttempted: boolean;
  /** Armed or in-flight FINAL_FLUSH (ownership-holding). */
  finalFlushArmed: boolean;
  /** lastSubmitted >= lastRequired and no further useful input remains. */
  usefulInputExhausted: boolean;
  /** AFE-12: WebCodecs decodeQueue HIGH_WATER (derived, never near 125). */
  decodeQueueHighWater: number;
  /** Peak decodeQueueSize observed this transaction. */
  decodeQueuePeak: number;
  /** Consecutive submits while lastDecodedTs stayed unchanged. */
  submitsWithoutOutputProgress: number;
  /** Times waitForDecodeCapacity paused at HIGH_WATER. */
  backpressureWaitCount: number;
  /** Currently paused at HIGH_WATER with no submit. */
  backpressureBlocked: boolean;
  /** INVARIANT: no output progress + queue>=HIGH_WATER → no more submit. */
  noMoreSubmission: boolean;
  lastOutputProgressTimestamp: number | null;
  /** Compact per-pump traces (phase + queue + lastDecoded). */
  submitPhaseTraces: SubmitPhaseTrace[];
  /** AFE-13: HIGH_WATER + stuck lastDecoded after recreate (cannot pump). */
  frozenAtHighWater: boolean;
  /** AFE-13: one walk-back GOP recover from an earlier keyframe already used. */
  earlierKeyframeRecovered: boolean;
  /** AFE-14: LOW_WATER hysteresis resume target (strictly below HIGH_WATER). */
  decodeQueueLowWater: number;
  /** AFE-14: explicit — false when gopStart==0 (do not re-loop AFE-13 escape). */
  earlierKeyframeAvailable: boolean;
  /** First decode-order sample submitted after the last recreate. */
  firstSubmittedAfterRecreate: number | null;
  firstSubmittedAfterRecreateKey: boolean | null;
  firstSubmittedAfterRecreatePts: number | null;
  firstSubmittedAfterRecreateDts: number | null;
  /** Cold vs recovery packet fingerprints (null = no recreate yet). */
  packetParity: boolean | null;
  packetParityCompared: number;
  packetParityMismatchIndex: number | null;
  packetParityMismatchField: string | null;
  /** Cold vs recovery decoder-config fingerprints (null = no recreate yet). */
  configParity: boolean | null;
  configParityHashCold: string | null;
  configParityHashRecovery: string | null;
  /** Compact post-recreate output PTS list (capped). */
  postRecreateOutputTimestamps: number[];
  postRecreateSubmitted: number;
  postRecreateOutputs: number;
  postRecreateLastDecodedTs: number | null;
  /** AFE-15: sticky — PTS was inserted at least once. Not live identity. */
  ptsEverRegistered: boolean;
  /** AFE-15: live PtsIndexMap / exact pending PTS for the focus sample. */
  ptsCurrentlyRegistered: boolean;
  /** Opened request PTS the dump is focused on. */
  targetPtsUs: number | null;
  /** WebCodecs emitted this exact PTS at least once (CASE A). */
  targetPtsSeen: boolean;
  targetPtsOutputCount: number;
  targetPtsLastSeenTs: number | null;
  /** Compact FINAL_FLUSH-window output timestamps (capped). */
  tailOutputTimestamps: number[];
  tailOutputCount: number;
  /** Live identity: map OR ready exact OR waiter OR active rebuild. */
  exactIdentityHolds: boolean;
  /** AFE-17: opened / focused requested sample index (alias of source). */
  requestedSample: number | null;
  /**
   * AFE-17: LOCAL decode-order horizon for the current exact requested sample.
   * min(lastRequired(requested), transaction lastRequired). Not lastRequired=140.
   */
  currentTargetRequiredSample: number | null;
  /** Sequential prefetch hint used for HIGH/LOW / local horizon. */
  prefetch: number | null;
  /** AFE-17: normal AFE-14/16 backpressure threshold (decodeQueueHighWater). */
  softHighWater: number;
  /**
   * AFE-17: bounded emergency queue ceiling. Soft + remaining local-horizon
   * credits, capped by lookahead+prefetch. Never lastRequired=140, never ~125.
   */
  hardDependencyCeiling: number;
  /** Submitted minus emitted (post-recreate when available). */
  submittedMinusOutputs: number;
};

/** One pumpThrough / recovery slice — stall dump only, no production spam. */
export type SubmitPhaseTrace = {
  phase: AfeStallPhase;
  submittedFrom: number | null;
  submittedTo: number | null;
  decodeQueueStart: number;
  decodeQueueEnd: number;
  lastDecodedStart: number | null;
  lastDecodedEnd: number | null;
  pausedForCapacity: boolean;
  outputProgressed: boolean;
};

export function emptyStallSnapshot(partial?: Partial<AfeStallSnapshot>): AfeStallSnapshot {
  return {
    exportFrameIndex: null,
    exportTimestampSec: null,
    sourceClipId: null,
    sourceClipLabel: null,
    sourceUrlName: null,
    sourceInMs: null,
    sourceOutMs: null,
    timelineMs: null,
    pictureKind: null,
    fps: null,
    visFrames: null,
    afeFrames: null,
    blackFrames: null,
    videoFramesRequested: null,
    videoFramesDecoded: null,
    videoFramesEncoded: null,
    visFramesEncoded: null,
    blackFramesEncoded: null,
    sourceSampleRequested: null,
    requestedPtsUs: null,
    decodeStartSample: null,
    lastSubmittedSample: null,
    decodeQueueSize: 0,
    streamPtsPending: 0,
    streamReadySize: 0,
    streamWaiterIndex: null,
    reorderCap: 0,
    lastVideoFrameTimestamp: null,
    lastSampleResolved: null,
    decoderFlushCount: 0,
    decoderResetCount: 0,
    decoderRecreateCount: 0,
    recoveryAttempts: 0,
    encoderEncodeQueueSize: null,
    lastProgressUpdateMs: null,
    pendingPts: [],
    readyIndexes: [],
    lastDecodedTimestamp: null,
    gopKeyframeStart: null,
    stalledMs: 0,
    lookahead: 0,
    maxReorderSamples: 0,
    stallPhase: null,
    transactionId: null,
    originRequestedSample: null,
    originRequestedPts: null,
    originExportFrame: null,
    originTimelineMs: null,
    originClipId: null,
    originClipLabel: null,
    originSourceName: null,
    originPictureKind: null,
    lastRequestedSample: null,
    lastRequiredDecodeSample: null,
    speculativeSamplesSubmitted: 0,
    cancelledSpeculativeSamples: 0,
    decodeQueueBeforeCancel: null,
    decoderResetForTransactionEnd: false,
    openedRequestedVideoFrames: 0,
    unresolvedRequestedVideoFrames: 0,
    transactionComplete: false,
    pumpSliceStart: null,
    pumpSliceEnd: null,
    ptsRegistered: false,
    ownershipWaiterActive: false,
    ownershipRebuilt: false,
    recoveryRebuilding: false,
    ownershipState: null,
    finalFlushAttempted: false,
    finalFlushArmed: false,
    usefulInputExhausted: false,
    decodeQueueHighWater: 0,
    decodeQueuePeak: 0,
    submitsWithoutOutputProgress: 0,
    backpressureWaitCount: 0,
    backpressureBlocked: false,
    noMoreSubmission: false,
    lastOutputProgressTimestamp: null,
    submitPhaseTraces: [],
    frozenAtHighWater: false,
    earlierKeyframeRecovered: false,
    decodeQueueLowWater: 0,
    earlierKeyframeAvailable: false,
    firstSubmittedAfterRecreate: null,
    firstSubmittedAfterRecreateKey: null,
    firstSubmittedAfterRecreatePts: null,
    firstSubmittedAfterRecreateDts: null,
    packetParity: null,
    packetParityCompared: 0,
    packetParityMismatchIndex: null,
    packetParityMismatchField: null,
    configParity: null,
    configParityHashCold: null,
    configParityHashRecovery: null,
    postRecreateOutputTimestamps: [],
    postRecreateSubmitted: 0,
    postRecreateOutputs: 0,
    postRecreateLastDecodedTs: null,
    ptsEverRegistered: false,
    ptsCurrentlyRegistered: false,
    targetPtsUs: null,
    targetPtsSeen: false,
    targetPtsOutputCount: 0,
    targetPtsLastSeenTs: null,
    tailOutputTimestamps: [],
    tailOutputCount: 0,
    exactIdentityHolds: false,
    requestedSample: null,
    currentTargetRequiredSample: null,
    prefetch: null,
    softHighWater: 0,
    hardDependencyCeiling: 0,
    submittedMinusOutputs: 0,
    ...partial,
  };
}

/**
 * Future decode-order samples that must be submitted before waiting for
 * the requested presentation frame. Prefetch-4 / +1 is not enough when
 * maxReorderSamples > 0 (B-frames / hardware DPB hold).
 */
export function streamLookaheadSamples(maxReorderSamples: number, prefetch: number): number {
  const reorder = Math.max(0, maxReorderSamples | 0);
  const pref = Math.max(1, prefetch | 0);
  if (reorder <= 0) return pref;
  return Math.min(16, Math.max(pref, reorder + 1, Math.min(16, reorder + 4)));
}

/**
 * Decode-window lookahead used for HIGH/LOW water (AFE-14).
 * Caps pump lookahead at AFE_DECODE_WINDOW_LOOKAHEAD (6). Not PREFETCH.
 */
export function decodeWindowLookahead(maxReorderSamples: number, prefetch: number): number {
  const pref = Math.max(1, prefetch | 0);
  return Math.min(AFE_DECODE_WINDOW_LOOKAHEAD, streamLookaheadSamples(maxReorderSamples, pref));
}

/**
 * Extra decode-order slots a B-frame / hardware DPB may need beyond the I.
 * Equals prefetch — not lookahead+prefetch (that plus the 40 floor made HIGH=40).
 */
export function decodeWindowBNeed(prefetch: number): number {
  return Math.max(1, prefetch | 0);
}

/**
 * WebCodecs decodeQueue HIGH_WATER (AFE-14 hysteresis).
 *
 * Formula:
 *   L           = min(WINDOW_LOOKAHEAD 6, streamLookaheadSamples(maxReorder, prefetch))
 *   B           = prefetch
 *   RAW         = maxReorder + L + B
 *   HIGH_FIRST  = min(CAP 48, max(RECOVERY_FILL 40, RAW))
 *                 first fill only — AFE-10 held sample 38 until ~36–44 submits
 *   HIGH_RECOVER= min(CAP 48, RAW)
 *                 after recreate the 40 floor is gone. Human 720p30
 *                 (reorder 10, prefetch 4, L 6) → HIGH 20 < 40.
 *   LOW_WATER   = min(HIGH - 1, max(L, B))            // LOW < HIGH
 *
 * WebView2 died at lastDecodedTs 458333 with a 40-deep *post-recreate* queue
 * (gopStart 0, no earlier I). Tight HIGH applies after recreate only.
 * First-fill RECOVERY_FILL stays so AFE-10/11 can still reach lastRequired
 * and FINAL_FLUSH on QueueHeld / HoldUntilSubmitted(36). No PREFETCH bump.
 */
export function decodeQueueHighWater(
  maxReorderSamples: number,
  prefetch: number,
  opts?: { afterRecreate?: boolean },
): number {
  const reorder = Math.max(0, maxReorderSamples | 0);
  const pref = Math.max(1, prefetch | 0);
  const look = decodeWindowLookahead(reorder, pref);
  const bNeed = decodeWindowBNeed(pref);
  const raw = Math.max(1, reorder + look + bNeed);
  const tight = Math.min(AFE_DECODE_QUEUE_HIGH_WATER_CAP, raw);
  if (opts?.afterRecreate) return tight;
  return Math.min(AFE_DECODE_QUEUE_HIGH_WATER_CAP, Math.max(AFE_DECODE_QUEUE_RECOVERY_FILL, raw));
}

/** Resume target after HIGH_WATER pause. Always strictly below HIGH_WATER. */
export function decodeQueueLowWater(
  maxReorderSamples: number,
  prefetch: number,
  opts?: { afterRecreate?: boolean },
): number {
  const high = decodeQueueHighWater(maxReorderSamples, prefetch, opts);
  const look = decodeWindowLookahead(maxReorderSamples, prefetch);
  const bNeed = decodeWindowBNeed(prefetch);
  return Math.max(0, Math.min(high - 1, Math.max(look, bNeed)));
}

/**
 * AFE-16 CAPACITY INVARIANT — dependency horizon is lastRequiredDecodeSample.
 *
 * Submitting the requested sample does **not** prove H.264 B-frame / reorder
 * dependencies have been supplied. If the exact requested frame is not ready,
 * useful undecoded input remains, lastSubmitted is still behind lastRequired,
 * and the queue is below HIGH_WATER, LOW_WATER hysteresis must not block.
 * Queued decoder input does **not** necessarily produce the requested PTS
 * (or any further output). Producer spends remaining HIGH-queue credits
 * toward lastRequired until exact ready, HIGH_WATER, or lastRequired is
 * fully submitted. SOFT HIGH_WATER remains the normal cap. AFE-17 may
 * borrow a bounded HARD_DEPENDENCY_CEILING only after recreate when the
 * current local target is still unsubmitted and the queue is already at SOFT.
 */
export function mustAdvanceTowardDependencyHorizon(args: {
  lastSubmittedSample: number | null;
  lastRequiredDecodeSample: number;
  decodeQueueSize: number;
  highWater: number;
  exactReady: boolean;
  usefulInputRemains: boolean;
}): boolean {
  if (args.exactReady) return false;
  if (!args.usefulInputRemains) return false;
  if (args.decodeQueueSize >= args.highWater) return false;
  return (args.lastSubmittedSample ?? -1) < args.lastRequiredDecodeSample;
}

/**
 * LOCAL decode-order horizon for the CURRENT exact requested sample.
 * lastRequiredDecodeSample(lastRequested=requested), then capped by the
 * transaction-wide lastRequired so lastRequired=140 cannot authorize a flood.
 */
export function currentTargetRequiredSample(args: {
  requested: number;
  maxReorderSamples: number;
  prefetch: number;
  sampleCount: number;
  lastRequiredDecodeSample?: number;
  nextRefOrGop?: number | null;
}): number {
  const local = lastRequiredDecodeSample({
    lastRequested: args.requested,
    maxReorderSamples: args.maxReorderSamples,
    prefetch: args.prefetch,
    sampleCount: args.sampleCount,
    nextRefOrGop: args.nextRefOrGop,
  });
  if (args.lastRequiredDecodeSample == null) return local;
  return Math.min(local, args.lastRequiredDecodeSample);
}

/**
 * HARD_DEPENDENCY_CEILING — emergency queue cap after recreate.
 *
 *   extraCap = L + B          // lookahead + prefetch; maxReorder already in SOFT
 *   extra    = min(remaining to local horizon, extraCap)
 *   HARD     = min(CAP 48, SOFT + extra)
 *
 * First-fill: HARD == SOFT (RECOVERY_FILL already admits the local window).
 * Never lastRequired=140. Never the old 40/125 flood.
 */
export function hardDependencyCeiling(args: {
  softHighWater: number;
  lastSubmittedSample: number | null;
  currentTargetRequiredSample: number;
  maxReorderSamples: number;
  prefetch: number;
  afterRecreate?: boolean;
}): number {
  const soft = Math.max(1, args.softHighWater | 0);
  if (!args.afterRecreate) return Math.min(AFE_DECODE_QUEUE_HIGH_WATER_CAP, soft);
  const submitted = args.lastSubmittedSample ?? -1;
  const remaining = Math.max(0, args.currentTargetRequiredSample - submitted);
  const extraCap =
    decodeWindowLookahead(args.maxReorderSamples, args.prefetch) +
    decodeWindowBNeed(args.prefetch);
  const extra = Math.min(remaining, Math.max(0, extraCap));
  return Math.min(AFE_DECODE_QUEUE_HIGH_WATER_CAP, soft + extra);
}

/**
 * AFE-17 emergency borrow. All of: exact unresolved, useful input remains,
 * currentTargetRequired > lastSubmitted, no output progress, queue already
 * at SOFT_HIGH_WATER, queue still below HARD. First-fill does not borrow.
 */
export function mayBorrowHardDependencyCredits(args: {
  exactReady: boolean;
  usefulInputRemains: boolean;
  currentTargetRequiredSample: number;
  lastSubmittedSample: number | null;
  outputProgressed: boolean;
  decodeQueueSize: number;
  softHighWater: number;
  hardDependencyCeiling: number;
  afterRecreate?: boolean;
}): boolean {
  if (args.afterRecreate === false) return false;
  if (args.exactReady) return false;
  if (!args.usefulInputRemains) return false;
  if ((args.lastSubmittedSample ?? -1) >= args.currentTargetRequiredSample) return false;
  if (args.outputProgressed) return false;
  if (args.decodeQueueSize < args.softHighWater) return false;
  if (args.decodeQueueSize >= args.hardDependencyCeiling) return false;
  return args.hardDependencyCeiling > args.softHighWater;
}

/**
 * Stall pumpSlice must describe the CURRENT / last actual submit attempt.
 * A planned leftover (e.g. 92-97) must not contradict PUMP_LOOKAHEAD:41-40.
 */
export function pumpSliceMatchesSubmitProvenance(args: {
  pumpSliceStart: number | null;
  pumpSliceEnd: number | null;
  submitPhaseTraces: readonly SubmitPhaseTrace[];
}): boolean {
  const last = args.submitPhaseTraces[args.submitPhaseTraces.length - 1];
  if (!last) return true;
  return args.pumpSliceStart === last.submittedFrom && args.pumpSliceEnd === last.submittedTo;
}

/**
 * Submit is allowed unless the decoder is at HIGH_WATER.
 * AFE-14: output progress alone does not refill above LOW_WATER.
 * Resume only at LOW_WATER or exact frame ready — not on every dequeue
 * after lastRequired is fully submitted.
 * AFE-16: LOW_WATER must not starve when mustAdvanceTowardDependencyHorizon.
 * AFE-17: mustBorrowHardDependencyCredits may spend queue slots up to HARD.
 */
export function maySubmitEncoded(args: {
  decodeQueueSize: number;
  highWater: number;
  outputProgressed: boolean;
  lowWater?: number;
  paused?: boolean;
  exactReady?: boolean;
  mustAdvanceTowardDependencyHorizon?: boolean;
  mustBorrowHardDependencyCredits?: boolean;
  hardDependencyCeiling?: number;
}): boolean {
  if (args.exactReady) return true;
  if (
    args.mustBorrowHardDependencyCredits &&
    args.hardDependencyCeiling != null &&
    args.decodeQueueSize < args.hardDependencyCeiling
  ) {
    return true;
  }
  if (args.decodeQueueSize >= args.highWater) return false;
  if (args.mustAdvanceTowardDependencyHorizon) return true;
  if (args.paused && args.lowWater != null && args.decodeQueueSize > args.lowWater) return false;
  if (args.decodeQueueSize < args.highWater && !args.paused) return true;
  if (args.outputProgressed && args.lowWater == null) return true;
  return args.decodeQueueSize < args.highWater;
}

/**
 * AFE-14: after a HIGH_WATER pause, resume only at LOW_WATER or exact ready.
 * A dequeue that leaves the queue between LOW and HIGH must not refill
 * once lastRequired is fully submitted.
 * AFE-16: if mustAdvanceTowardDependencyHorizon, resume whenever queue < HIGH.
 * AFE-17: mustBorrowHardDependencyCredits resumes while queue < HARD.
 */
export function mayResumeDecode(args: {
  decodeQueueSize: number;
  highWater: number;
  lowWater: number;
  exactReady: boolean;
  paused: boolean;
  mustAdvanceTowardDependencyHorizon?: boolean;
  mustBorrowHardDependencyCredits?: boolean;
  hardDependencyCeiling?: number;
}): boolean {
  if (args.exactReady) return true;
  if (
    args.mustBorrowHardDependencyCredits &&
    args.hardDependencyCeiling != null &&
    args.decodeQueueSize < args.hardDependencyCeiling
  ) {
    return true;
  }
  if (args.mustAdvanceTowardDependencyHorizon && args.decodeQueueSize < args.highWater) return true;
  if (!args.paused) return args.decodeQueueSize < args.highWater;
  return args.decodeQueueSize <= args.lowWater;
}

/** INVARIANT: no output progress + queue>=HIGH_WATER → do not submit / decode(). */
export function noMoreSubmissionRequired(args: {
  decodeQueueSize: number;
  highWater: number;
  outputProgressed: boolean;
}): boolean {
  return args.decodeQueueSize >= args.highWater && !args.outputProgressed;
}

/**
 * AFE-13 deadlock: after recreate the producer is paused at HIGH_WATER
 * waiting for output that never comes, and FINAL_FLUSH is illegal because
 * lastSubmitted < lastRequired. Cannot pump, cannot flush.
 */
export function frozenHighWaterDeadlock(args: {
  recreateCount: number;
  decodeQueueSize: number;
  highWater: number;
  lastDecodedStuck: boolean;
  unresolvedRequestedVideoFrames: number;
  lastSubmittedSample: number | null;
  lastRequiredDecodeSample: number | null;
  backpressureBlocked: boolean;
  noMoreSubmission: boolean;
}): boolean {
  if (args.recreateCount < 1) return false;
  if (args.unresolvedRequestedVideoFrames <= 0) return false;
  if (args.decodeQueueSize < args.highWater) return false;
  if (!args.lastDecodedStuck) return false;
  if (!args.noMoreSubmission || !args.backpressureBlocked) return false;
  const submitted = args.lastSubmittedSample ?? -1;
  const required = args.lastRequiredDecodeSample ?? -1;
  return submitted < required;
}

/**
 * Producer permanently noMoreSubmission, lastDecoded unchanged, and
 * lastSubmitted < lastRequired — useful decode progress is impossible
 * without an earlier-keyframe recreate. Not a FINAL_FLUSH trigger
 * (AFE-06: no mid-run flush as pressure release).
 */
export function usefulProgressImpossible(args: {
  noMoreSubmission: boolean;
  lastDecodedUnchanged: boolean;
  lastSubmittedSample: number | null;
  lastRequiredDecodeSample: number | null;
}): boolean {
  if (!args.noMoreSubmission || !args.lastDecodedUnchanged) return false;
  const submitted = args.lastSubmittedSample ?? -1;
  const required = args.lastRequiredDecodeSample ?? -1;
  return submitted < required;
}

/**
 * ONE additional controlled GOP recover from an earlier I-frame.
 * Prefer this before any flush. Null origin → typed stall, not flush.
 */
export function mayEarlierKeyframeRecover(args: {
  frozenHighWaterAfterRecreate: boolean;
  earlierKeyframeOrigin: number | null;
  earlierKeyframeRecovered: boolean;
  gopKeyframeStart?: number | null;
  earlierKeyframeAvailable?: boolean;
}): boolean {
  if (!args.frozenHighWaterAfterRecreate) return false;
  if (args.earlierKeyframeRecovered) return false;
  if (args.gopKeyframeStart != null && args.gopKeyframeStart <= 0) return false;
  if (args.earlierKeyframeAvailable === false) return false;
  return args.earlierKeyframeOrigin != null && args.earlierKeyframeOrigin >= 0;
}

export type PumpSubmitArgs = {
  requested: number;
  last: number;
  nextDecode: number;
  sampleCount: number;
  prefetch: number;
  maxReorderSamples: number;
  pendingOutputCount: number;
};

/**
 * Inclusive decode-order index this pump call must submit through.
 * Lookahead is required even past `last` (extras are discarded, not presented).
 * pendingOutputCount may only stop work AFTER the lookahead window is filled.
 */
export function pumpSubmitEnd(args: PumpSubmitArgs): number {
  const { requested, last, nextDecode, sampleCount, prefetch, maxReorderSamples, pendingOutputCount } =
    args;
  if (sampleCount <= 0) return -1;
  const look = streamLookaheadSamples(maxReorderSamples, prefetch);
  const hi = sampleCount - 1;
  const must = Math.min(hi, requested + look);
  const cap = Math.min(hi, Math.max(last, requested + look));
  let end = nextDecode - 1;
  let pending = pendingOutputCount;
  for (let s = nextDecode; s <= cap; s++) {
    if (s > must && pending >= prefetch + look) break;
    end = s;
    pending += 1;
  }
  return end;
}

/** AFE-04 +1-only window. Used in tests to prove the deadlock, not in production. */
export function legacyPumpSubmitEnd(args: PumpSubmitArgs): number {
  const { requested, last, nextDecode, sampleCount, prefetch, pendingOutputCount } = args;
  if (sampleCount <= 0) return -1;
  const hi = sampleCount - 1;
  const target = Math.min(last, requested + prefetch, hi);
  let end = nextDecode - 1;
  let pending = pendingOutputCount;
  for (let s = nextDecode; s <= target; s++) {
    if (s > requested && pending >= prefetch) break;
    end = s;
    pending += 1;
  }
  if (end + 1 === requested + 1 && end + 1 <= last && end + 1 <= hi) {
    end += 1;
  }
  return end;
}

export type PumpMoreArgs = {
  requested: number;
  nextDecode: number;
  sampleCount: number;
  prefetch: number;
  maxReorderSamples: number;
  /**
   * Next I / ref after the requested sample. Null = none (do not substitute EOF).
   * A far GOP past lastRequired is speculative and is ignored.
   */
  nextRefOrGop: number | null;
  /** Last VIDEO sample this transaction actually requested. */
  lastRequested?: number;
};

/**
 * Inclusive decode-order ceiling: last requested + B-reorder + prefetch.
 * Next GOP is a required ref only when it sits inside that window.
 * EOF is never a substitute for a missing keyframe.
 */
export function lastRequiredDecodeSample(args: {
  lastRequested: number;
  maxReorderSamples: number;
  prefetch: number;
  sampleCount: number;
  nextRefOrGop?: number | null;
}): number {
  if (args.sampleCount <= 0) return -1;
  const hi = args.sampleCount - 1;
  const last = Math.max(0, args.lastRequested | 0);
  const look = streamLookaheadSamples(args.maxReorderSamples, args.prefetch);
  const structural = last + Math.max(0, args.maxReorderSamples | 0) + Math.max(1, args.prefetch | 0);
  let bound = Math.max(last, structural, last + look);
  const ref = args.nextRefOrGop;
  if (ref != null && ref > last && ref <= bound) {
    bound = Math.max(bound, ref);
  }
  return Math.min(hi, bound);
}

export function classifySampleRole(
  index: number,
  args: {
    requestedIndexes: ReadonlySet<number> | readonly number[];
    decodeStart: number;
    lastRequiredDecodeSample: number;
  },
): SampleRole {
  const requested = args.requestedIndexes instanceof Set
    ? args.requestedIndexes
    : new Set(args.requestedIndexes);
  if (requested.has(index)) return "REQUESTED";
  if (index >= args.decodeStart && index <= args.lastRequiredDecodeSample) return "REFERENCE_REQUIRED";
  return "SPECULATIVE";
}

/**
 * STEP B — structure-bounded extra submit. Not a lookahead raise.
 * End = min(EOF, lastRequired, max(N+maxReorder+prefetch, in-window next ref)).
 */
export function pumpMoreSubmitEnd(args: PumpMoreArgs): number {
  const { requested, nextDecode, sampleCount, prefetch, maxReorderSamples, nextRefOrGop } = args;
  if (sampleCount <= 0) return -1;
  const hi = sampleCount - 1;
  const lastReq = args.lastRequested ?? requested;
  const structural = requested + Math.max(0, maxReorderSamples | 0) + Math.max(1, prefetch | 0);
  const lastBound = lastRequiredDecodeSample({
    lastRequested: lastReq,
    maxReorderSamples,
    prefetch,
    sampleCount,
    nextRefOrGop,
  });
  let cand = Math.max(structural, requested);
  if (nextRefOrGop != null && nextRefOrGop >= 0) {
    cand = Math.max(cand, Math.min(nextRefOrGop, lastBound));
  }
  const bound = Math.min(hi, cand, lastBound);
  return Math.max(nextDecode - 1, bound);
}

/**
 * Current requested sample is the last of this run, or decode reached EOF.
 * AFE-11: FINAL_FLUSH must not require this when useful input is exhausted.
 */
export function isTrueTransactionTail(args: {
  requested: number;
  lastRequested: number;
  nextDecode: number;
  sampleCount: number;
}): boolean {
  if (args.sampleCount <= 0) return true;
  if (args.nextDecode >= args.sampleCount) return true;
  return args.requested === args.lastRequested;
}

export function hasFurtherUsefulInput(args: {
  nextDecode: number;
  sampleCount: number;
  lastRequiredDecodeSample: number;
}): boolean {
  if (args.sampleCount <= 0) return false;
  return args.nextDecode <= args.lastRequiredDecodeSample && args.nextDecode < args.sampleCount;
}

/** lastSubmitted >= lastRequired and no further useful decode-order input remains. */
export function usefulInputExhausted(args: {
  lastSubmittedSample?: number | null;
  lastRequiredDecodeSample: number;
  nextDecode: number;
  sampleCount: number;
}): boolean {
  if (args.sampleCount <= 0) return true;
  const submitted = args.lastSubmittedSample ?? args.nextDecode - 1;
  if (submitted < args.lastRequiredDecodeSample) return false;
  return !hasFurtherUsefulInput({
    nextDecode: args.nextDecode,
    sampleCount: args.sampleCount,
    lastRequiredDecodeSample: args.lastRequiredDecodeSample,
  });
}

/**
 * FINAL_FLUSH when unresolved requested VIDEO remains and useful input is
 * exhausted. Do not require atTail(currentRequestedSample).
 *
 * All of: unresolved>0, lastSubmitted>=lastRequired, no further useful input,
 * waiter not active, pending PTS empty, not recoveryRebuilding, not complete.
 */
export function mayFinalFlush(args: {
  unresolvedRequestedVideoFrames: number;
  nextDecode: number;
  sampleCount: number;
  lastRequiredDecodeSample: number;
  lastSubmittedSample?: number | null;
  streamWaiterIndex?: number | null;
  pendingPtsCount?: number;
  pendingPts?: readonly number[] | null;
  recoveryRebuilding?: boolean;
  transactionComplete?: boolean;
}): boolean {
  if (args.unresolvedRequestedVideoFrames <= 0) return false;
  if (args.transactionComplete) return false;
  if (args.recoveryRebuilding) return false;
  if (args.streamWaiterIndex != null) return false;
  const pending =
    args.pendingPtsCount ??
    (args.pendingPts != null ? args.pendingPts.length : 0);
  if (pending > 0) return false;
  return usefulInputExhausted({
    lastSubmittedSample: args.lastSubmittedSample,
    lastRequiredDecodeSample: args.lastRequiredDecodeSample,
    nextDecode: args.nextDecode,
    sampleCount: args.sampleCount,
  });
}

export function isTransactionComplete(args: {
  unresolvedRequestedVideoFrames: number;
  streamWaiterIndex: number | null;
  requestedVideoFrameCount?: number | null;
  resolvedRequestedVideoFrames?: number | null;
  openedRequestedVideoFrames?: number | null;
  videoFramesRequested?: number | null;
  videoFramesDecoded?: number | null;
  videoFramesEncoded?: number | null;
}): boolean {
  if (args.streamWaiterIndex != null) return false;
  if (args.unresolvedRequestedVideoFrames > 0) return false;
  const opened = args.openedRequestedVideoFrames ?? args.requestedVideoFrameCount;
  const got = args.resolvedRequestedVideoFrames;
  if (opened != null && opened > 0 && got != null && got < opened) return false;
  const req = args.videoFramesRequested;
  const dec = args.videoFramesDecoded;
  const enc = args.videoFramesEncoded;
  if (req != null && dec != null && enc != null && (req !== dec || dec !== enc)) return false;
  return true;
}

/**
 * AFE-15: until RESOLVED / ERROR / ABORT, retain exact identity via
 * PtsIndexMap OR streamReady exact OR exact waiter OR active recovery
 * rebuild. FINAL_FLUSH_ARMED and stale ptsEverRegistered are not identity.
 * Else immediate AFE_REQUEST_OWNERSHIP_LOST.
 *
 * `ptsRegistered` means currently registered (live map / exact pending),
 * never "ever registered".
 */
export function exactRequestIdentityHolds(args: {
  unresolvedRequestedVideoFrames: number;
  streamWaiterIndex?: number | null;
  pendingPtsCount?: number;
  pendingPts?: readonly number[] | null;
  requestedPtsUs?: number | null;
  ptsRegistered?: boolean;
  ptsCurrentlyRegistered?: boolean;
  streamReadyExact?: boolean;
  recoveryRebuilding?: boolean;
}): boolean {
  if (args.unresolvedRequestedVideoFrames <= 0) return true;
  if (args.streamWaiterIndex != null) return true;
  if (args.streamReadyExact) return true;
  if (args.recoveryRebuilding) return true;
  if (args.ptsCurrentlyRegistered || args.ptsRegistered) return true;
  if (args.requestedPtsUs != null && args.pendingPts != null) {
    return args.pendingPts.includes(args.requestedPtsUs);
  }
  const pending =
    args.pendingPtsCount ??
    (args.pendingPts != null ? args.pendingPts.length : 0);
  return pending > 0;
}

/**
 * AFE-11/15: opened unresolved VIDEO must own decode. Ledger-only without
 * live exact identity is immediate OWNERSHIP_LOST (no 3s mystery stall).
 * `finalFlushArmed` / `finalFlushInProgress` are accepted for signature
 * compatibility and ignored — a flag is not PTS identity.
 */
export function requestOwnershipHolds(args: {
  unresolvedRequestedVideoFrames: number;
  streamWaiterIndex?: number | null;
  pendingPtsCount?: number;
  pendingPts?: readonly number[] | null;
  requestedPtsUs?: number | null;
  ptsRegistered?: boolean;
  ptsCurrentlyRegistered?: boolean;
  streamReadyExact?: boolean;
  recoveryRebuilding?: boolean;
  finalFlushArmed?: boolean;
  finalFlushInProgress?: boolean;
}): boolean {
  return exactRequestIdentityHolds(args);
}

/**
 * Human 720p30 tail: lastRequired 140 vs requested 134. Closed when
 * submitted reached lastRequired and lastRequired already covers the
 * structural B-ref window or EOF. Not a reason to raise HIGH_WATER.
 */
export function tailDependencyClosed(args: {
  requested: number;
  lastRequiredDecodeSample: number;
  lastSubmittedSample?: number | null;
  sampleCount: number;
  maxReorderSamples?: number;
  prefetch?: number;
}): boolean {
  if (args.sampleCount <= 0) return true;
  const submitted = args.lastSubmittedSample ?? args.lastRequiredDecodeSample;
  if (submitted < args.lastRequiredDecodeSample) return false;
  const structural = lastRequiredDecodeSample({
    lastRequested: args.requested,
    maxReorderSamples: args.maxReorderSamples ?? 0,
    prefetch: args.prefetch ?? 1,
    sampleCount: args.sampleCount,
  });
  return args.lastRequiredDecodeSample >= structural;
}

/**
 * CASE B genuine WebCodecs drain — all of: unresolved, useful input
 * exhausted, FINAL_FLUSH already attempted, target PTS never seen,
 * hardware still holding (queue>0) or lastDecoded is not the target,
 * not rebuilding, not complete. Not a GOP/backpressure escape.
 */
export function mayGenuineFinalDrain(args: {
  unresolvedRequestedVideoFrames: number;
  usefulInputExhausted: boolean;
  finalFlushAttempted: boolean;
  targetPtsSeen: boolean;
  decodeQueueSize: number;
  lastDecodedTimestamp?: number | null;
  targetPtsUs?: number | null;
  recoveryRebuilding?: boolean;
  transactionComplete?: boolean;
}): boolean {
  if (args.unresolvedRequestedVideoFrames <= 0) return false;
  if (!args.usefulInputExhausted) return false;
  if (!args.finalFlushAttempted) return false;
  if (args.targetPtsSeen) return false;
  if (args.recoveryRebuilding) return false;
  if (args.transactionComplete) return false;
  return args.decodeQueueSize > 0;
}

/**
 * Inclusive decode-order end of one bounded progressive slice toward
 * lastRequired. Slice size is lookahead-sized — not a global PREFETCH bump.
 */
export function progressivePumpSliceEnd(args: {
  nextDecode: number;
  lastRequiredDecodeSample: number;
  sampleCount: number;
  sliceSamples: number;
}): number {
  if (args.sampleCount <= 0) return -1;
  const hi = Math.min(args.sampleCount - 1, args.lastRequiredDecodeSample);
  if (args.nextDecode > hi) return args.nextDecode - 1;
  const slice = Math.max(1, args.sliceSamples | 0);
  return Math.min(hi, args.nextDecode + slice - 1);
}

/**
 * One ledger: opened VIDEO presentation samples still open vs Enc/Req.
 * `unresolvedRequested>0` with `Enc>=Req` is the AFE-09 contradiction — fail closed.
 */
export function requestedEncodedInvariantHolds(args: {
  unresolvedRequestedVideoFrames: number;
  videoFramesRequested?: number | null;
  videoFramesEncoded?: number | null;
}): boolean {
  const unresolved = args.unresolvedRequestedVideoFrames;
  const req = args.videoFramesRequested;
  const enc = args.videoFramesEncoded;
  if (unresolved < 0) return false;
  if (req == null || enc == null) return true;
  if (!Number.isFinite(req) || !Number.isFinite(enc) || req < 0 || enc < 0) return false;
  if (unresolved > 0 && enc >= req) return false;
  return true;
}

/**
 * Windows AFE-08 shape: TRANSACTION_END + null request + Req==Enc
 * is transaction complete, not AFE_DECODE_STALL.
 */
export function isExportTransactionComplete(dump: Partial<AfeStallSnapshot>): boolean {
  const req = dump.videoFramesRequested;
  const dec = dump.videoFramesDecoded;
  const enc = dump.videoFramesEncoded;
  if (req == null || dec == null || enc == null) return false;
  if (req !== dec || dec !== enc) return false;
  if (dump.streamWaiterIndex != null) return false;
  if ((dump.unresolvedRequestedVideoFrames ?? 0) > 0) return false;
  if (!requestedEncodedInvariantHolds({
    unresolvedRequestedVideoFrames: dump.unresolvedRequestedVideoFrames ?? 0,
    videoFramesRequested: req,
    videoFramesEncoded: enc,
  })) {
    return false;
  }
  const nullRequest = dump.sourceSampleRequested == null && dump.requestedPtsUs == null;
  if (dump.stallPhase === "TRANSACTION_END" && (nullRequest || dump.transactionComplete === true)) {
    return true;
  }
  return isTransactionComplete({
    unresolvedRequestedVideoFrames: dump.unresolvedRequestedVideoFrames ?? 0,
    streamWaiterIndex: dump.streamWaiterIndex ?? null,
    requestedVideoFrameCount: dump.openedRequestedVideoFrames ?? (dump.lastRequestedSample != null ? 1 : null),
    resolvedRequestedVideoFrames: dump.transactionComplete ? (dump.openedRequestedVideoFrames ?? 1) : 0,
    openedRequestedVideoFrames: dump.openedRequestedVideoFrames,
    videoFramesRequested: req,
    videoFramesDecoded: dec,
    videoFramesEncoded: enc,
  });
}

export function originFromStall(partial: Partial<AfeStallSnapshot>): Partial<AfeStallSnapshot> {
  const sample = partial.originRequestedSample ?? partial.sourceSampleRequested ?? null;
  const pts = partial.originRequestedPts ?? partial.requestedPtsUs ?? null;
  return {
    originRequestedSample: sample,
    originRequestedPts: pts,
    originExportFrame: partial.originExportFrame ?? partial.exportFrameIndex ?? null,
    originTimelineMs: partial.originTimelineMs ?? partial.timelineMs ?? null,
    originClipId: partial.originClipId ?? partial.sourceClipId ?? null,
    originClipLabel: partial.originClipLabel ?? partial.sourceClipLabel ?? null,
    originSourceName: partial.originSourceName ?? partial.sourceUrlName ?? null,
    originPictureKind: partial.originPictureKind ?? partial.pictureKind ?? null,
    sourceSampleRequested: partial.sourceSampleRequested ?? sample,
    requestedPtsUs: partial.requestedPtsUs ?? pts,
  };
}

export function formatStallMessage(dump: Partial<AfeStallSnapshot>): string {
  const d = emptyStallSnapshot(dump);
  const clip = d.originClipLabel ?? d.sourceClipLabel ?? d.originClipId ?? d.sourceClipId;
  return [
    `requested sample ${d.sourceSampleRequested ?? d.originRequestedSample} PTS ${d.requestedPtsUs ?? d.originRequestedPts}`,
    `originSample ${d.originRequestedSample}`,
    `originPts ${d.originRequestedPts}`,
    `originExportFrame ${d.originExportFrame}`,
    `originTimelineMs ${d.originTimelineMs}`,
    `originClip ${d.originClipLabel ?? d.originClipId}`,
    `originSource ${d.originSourceName}`,
    `originPicture ${d.originPictureKind}`,
    `stallPhase ${d.stallPhase}`,
    `transactionId ${d.transactionId}`,
    `pending PTS [${d.pendingPts.join(",")}]`,
    `ready [${d.readyIndexes.join(",")}]`,
    `decodeQueue ${d.decodeQueueSize}`,
    `lastDecodedTs ${d.lastDecodedTimestamp}`,
    `gopStart ${d.gopKeyframeStart}`,
    `decodeStart ${d.decodeStartSample}`,
    `frozenAtHighWater ${d.frozenAtHighWater ? "yes" : "no"}`,
    `earlierKeyframeRecovered ${d.earlierKeyframeRecovered ? "yes" : "no"}`,
    `earlierKeyframeAvailable ${d.earlierKeyframeAvailable ? "yes" : "no"}`,
    `firstSubmittedAfterRecreate ${d.firstSubmittedAfterRecreate}`,
    `firstSubmittedAfterRecreateKey ${d.firstSubmittedAfterRecreateKey == null ? "n/a" : d.firstSubmittedAfterRecreateKey ? "yes" : "no"}`,
    `firstSubmittedAfterRecreatePts ${d.firstSubmittedAfterRecreatePts}`,
    `firstSubmittedAfterRecreateDts ${d.firstSubmittedAfterRecreateDts}`,
    `packetParity ${d.packetParity == null ? "n/a" : d.packetParity ? "yes" : "no"}`,
    `packetParityCompared ${d.packetParityCompared}`,
    `packetParityMismatch ${d.packetParityMismatchIndex == null ? "none" : `${d.packetParityMismatchIndex}:${d.packetParityMismatchField ?? "?"}`}`,
    `configParity ${d.configParity == null ? "n/a" : d.configParity ? "yes" : "no"}`,
    `configParityHashCold ${d.configParityHashCold}`,
    `configParityHashRecovery ${d.configParityHashRecovery}`,
    `postRecreateSubmitted ${d.postRecreateSubmitted}`,
    `postRecreateOutputs ${d.postRecreateOutputs}`,
    `postRecreateLastDecodedTs ${d.postRecreateLastDecodedTs}`,
    `postRecreateOutputTs [${d.postRecreateOutputTimestamps.join(",")}]`,
    `submitted ${d.lastSubmittedSample}`,
    `lastSubmittedSample ${d.lastSubmittedSample} (sample-index)`,
    `waiter ${d.streamWaiterIndex}`,
    `streamPts ${d.streamPtsPending}`,
    `streamReady ${d.streamReadySize}`,
    `reorderCap ${d.reorderCap}`,
    `lookahead ${d.lookahead}`,
    `flushes ${d.decoderFlushCount}`,
    `resets ${d.decoderResetCount}`,
    `recreates ${d.decoderRecreateCount}`,
    `recoveryAttempts ${d.recoveryAttempts}`,
    `encoderQ ${d.encoderEncodeQueueSize}`,
    `exportFrame ${d.exportFrameIndex ?? d.originExportFrame}`,
    `clip ${clip}`,
    `clipId ${d.originClipId ?? d.sourceClipId}`,
    `source ${d.originSourceName ?? d.sourceUrlName}`,
    `sourceInMs ${d.sourceInMs}`,
    `sourceOutMs ${d.sourceOutMs}`,
    `timelineMs ${d.originTimelineMs ?? d.timelineMs}`,
    `picture ${d.originPictureKind ?? d.pictureKind}`,
    `fps ${d.fps}`,
    `visFrames ${d.visFrames}`,
    `afeFrames ${d.afeFrames}`,
    `blackFrames ${d.blackFrames}`,
    `videoReq ${d.videoFramesRequested} (frame-count)`,
    `videoDec ${d.videoFramesDecoded} (frame-count)`,
    `videoEnc ${d.videoFramesEncoded} (frame-count)`,
    `requestedSample ${d.requestedSample ?? d.sourceSampleRequested}`,
    `lastRequestedSample ${d.lastRequestedSample} (sample-index)`,
    `currentTargetRequiredSample ${d.currentTargetRequiredSample}`,
    `lastRequiredDecodeSample ${d.lastRequiredDecodeSample} (sample-index)`,
    `maxReorderSamples ${d.maxReorderSamples}`,
    `prefetch ${d.prefetch}`,
    `speculativeSubmitted ${d.speculativeSamplesSubmitted}`,
    `cancelledSpeculativeSamples ${d.cancelledSpeculativeSamples}`,
    `decodeQueueBeforeCancel ${d.decodeQueueBeforeCancel}`,
    `decoderResetForTransactionEnd ${d.decoderResetForTransactionEnd}`,
    `openedRequested ${d.openedRequestedVideoFrames} (presentation asked)`,
    `unresolvedRequested ${d.unresolvedRequestedVideoFrames}`,
    `transactionComplete ${d.transactionComplete}`,
    `pumpSlice ${d.pumpSliceStart}-${d.pumpSliceEnd}`,
    `ptsRegistered ${d.ptsRegistered ? "yes" : "no"}`,
    `ptsEverRegistered ${d.ptsEverRegistered ? "yes" : "no"}`,
    `ptsCurrentlyRegistered ${d.ptsCurrentlyRegistered ? "yes" : "no"}`,
    `targetPts ${d.targetPtsUs}`,
    `targetPtsSeen ${d.targetPtsSeen ? "yes" : "no"}`,
    `targetPtsOutputs ${d.targetPtsOutputCount}`,
    `targetPtsLastSeenTs ${d.targetPtsLastSeenTs}`,
    `tailOutputs ${d.tailOutputCount}`,
    `tailOutputTs [${d.tailOutputTimestamps.join(",")}]`,
    `exactIdentity ${d.exactIdentityHolds ? "yes" : "no"}`,
    `waiterActive ${d.ownershipWaiterActive ? "yes" : "no"}`,
    `ownershipRebuilt ${d.ownershipRebuilt ? "yes" : "no"}`,
    `recoveryRebuilding ${d.recoveryRebuilding ? "yes" : "no"}`,
    `ownershipState ${d.ownershipState}`,
    `FINAL_FLUSH ${d.finalFlushAttempted || d.finalFlushArmed ? "yes" : "no"}`,
    `finalFlushArmed ${d.finalFlushArmed ? "yes" : "no"}`,
    `usefulInputExhausted ${d.usefulInputExhausted ? "yes" : "no"}`,
    `decodeQueueHighWater ${d.decodeQueueHighWater}`,
    `softHighWater ${d.softHighWater || d.decodeQueueHighWater}`,
    `hardDependencyCeiling ${d.hardDependencyCeiling}`,
    `submittedMinusOutputs ${d.submittedMinusOutputs}`,
    `decodeQueueLowWater ${d.decodeQueueLowWater}`,
    `decodeQueuePeak ${d.decodeQueuePeak}`,
    `submitsWithoutOutputProgress ${d.submitsWithoutOutputProgress}`,
    `backpressureWaits ${d.backpressureWaitCount}`,
    `backpressureBlocked ${d.backpressureBlocked ? "yes" : "no"}`,
    `noMoreSubmission ${d.noMoreSubmission ? "yes" : "no"}`,
    `lastOutputProgressTs ${d.lastOutputProgressTimestamp}`,
    `submitPhases ${formatSubmitPhaseTraces(d.submitPhaseTraces)}`,
    `stalledMs ${d.stalledMs}`,
  ].join("; ");
}

function formatSubmitPhaseTraces(traces: readonly SubmitPhaseTrace[]): string {
  if (!traces.length) return "[]";
  return traces
    .map(
      (t) =>
        `${t.phase}:${t.submittedFrom}-${t.submittedTo}/q${t.decodeQueueStart}->${t.decodeQueueEnd}/ts${t.lastDecodedStart}->${t.lastDecodedEnd}${t.pausedForCapacity ? "/paused" : ""}${t.outputProgressed ? "/progress" : ""}`,
    )
    .join("|");
}

/** Host-safe leaf name only — no path, user folder, or query. */
export function hostSafeSourceName(sourceUrl: string | undefined | null): string {
  if (!sourceUrl) return "source";
  const trimmed = sourceUrl.trim();
  if (!trimmed) return "source";
  const noQuery = trimmed.split("?")[0] ?? trimmed;
  const leaf = noQuery.split(/[\\/]/).filter(Boolean).pop() ?? noQuery;
  const cleaned = leaf.replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^_+|_+$/g, "");
  return cleaned || "source";
}

export function requestedPtsIsPending(pendingPts: readonly number[], requestedPtsUs: number | null): boolean {
  if (requestedPtsUs == null) return false;
  return pendingPts.includes(requestedPtsUs);
}

export function nowMs(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

export function requestedVideoFateLegal(fate: SampleFate | undefined): boolean {
  if (!fate || fate === "PENDING") return true;
  return fate !== "DISCARDED_NOT_NEEDED";
}
