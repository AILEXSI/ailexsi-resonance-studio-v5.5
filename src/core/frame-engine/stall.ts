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
 * Minimum recovery fill that must be legal after GOP recreate.
 * Windows AFE-10: WebView2 held sample 38 until ~36–44 decode-order submits.
 * 40 admits that one fill. 40 is far below the Windows flood of 125.
 */
export const AFE_DECODE_QUEUE_RECOVERY_FILL = 40;

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
 * WebCodecs decodeQueue HIGH_WATER (AFE-12).
 *
 * Formula:
 *   HIGH_WATER = min(CAP, max(RECOVERY_FILL, maxReorder + lookahead + bFrameNeed))
 *   lookahead    = streamLookaheadSamples(maxReorder, prefetch)
 *   bFrameNeed   = lookahead + prefetch
 *                  extra decode-order samples a B-frame / hardware DPB may
 *                  require beyond maxReorder before the next output
 *   RECOVERY_FILL = 40
 *                  Windows AFE-10 held sample 38 until ~36–44 submits after
 *                  recreate. One recovery fill must be legal. Not a PREFETCH bump.
 *   CAP           = 48
 *                  never near the Windows AFE-12 flood of decodeQueue 125
 *
 * Typical prefetch=4, maxReorder=2 → lookahead=6 → raw=2+6+6+4=18 → HIGH_WATER=40.
 * High reorder=16 → lookahead=16 → raw=16+16+16+4=52 → HIGH_WATER=48.
 */
export function decodeQueueHighWater(maxReorderSamples: number, prefetch: number): number {
  const reorder = Math.max(0, maxReorderSamples | 0);
  const pref = Math.max(1, prefetch | 0);
  const look = streamLookaheadSamples(reorder, pref);
  const bFrameNeed = look + pref;
  const raw = reorder + look + bFrameNeed;
  return Math.min(
    AFE_DECODE_QUEUE_HIGH_WATER_CAP,
    Math.max(AFE_DECODE_QUEUE_RECOVERY_FILL, raw),
  );
}

/**
 * Submit is allowed unless the decoder is at HIGH_WATER with no output
 * progress. Then NO_MORE_SUBMISSION until dequeue / output / exact resolve
 * or a typed stall.
 */
export function maySubmitEncoded(args: {
  decodeQueueSize: number;
  highWater: number;
  outputProgressed: boolean;
}): boolean {
  if (args.decodeQueueSize < args.highWater) return true;
  if (args.outputProgressed) return true;
  return false;
}

/** INVARIANT: no output progress + queue>=HIGH_WATER → do not submit. */
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
}): boolean {
  if (!args.frozenHighWaterAfterRecreate) return false;
  if (args.earlierKeyframeRecovered) return false;
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
 * AFE-11: opened unresolved VIDEO must own decode. Ledger-only without a
 * waiter, pending/registered PTS, recovery rebuild, or armed FINAL_FLUSH
 * is immediate OWNERSHIP_LOST (no 3s mystery stall).
 */
export function requestOwnershipHolds(args: {
  unresolvedRequestedVideoFrames: number;
  streamWaiterIndex?: number | null;
  pendingPtsCount?: number;
  pendingPts?: readonly number[] | null;
  ptsRegistered?: boolean;
  recoveryRebuilding?: boolean;
  finalFlushArmed?: boolean;
  finalFlushInProgress?: boolean;
}): boolean {
  if (args.unresolvedRequestedVideoFrames <= 0) return true;
  if (args.streamWaiterIndex != null) return true;
  if (args.recoveryRebuilding) return true;
  if (args.finalFlushArmed || args.finalFlushInProgress) return true;
  if (args.ptsRegistered) return true;
  const pending =
    args.pendingPtsCount ??
    (args.pendingPts != null ? args.pendingPts.length : 0);
  return pending > 0;
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
    `frozenAtHighWater ${d.frozenAtHighWater ? "yes" : "no"}`,
    `earlierKeyframeRecovered ${d.earlierKeyframeRecovered ? "yes" : "no"}`,
    `submitted ${d.lastSubmittedSample}`,
    `lastSubmittedSample ${d.lastSubmittedSample} (sample-index)`,
    `decodeStart ${d.decodeStartSample}`,
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
    `lastRequestedSample ${d.lastRequestedSample} (sample-index)`,
    `lastRequiredDecodeSample ${d.lastRequiredDecodeSample} (sample-index)`,
    `speculativeSubmitted ${d.speculativeSamplesSubmitted}`,
    `cancelledSpeculativeSamples ${d.cancelledSpeculativeSamples}`,
    `decodeQueueBeforeCancel ${d.decodeQueueBeforeCancel}`,
    `decoderResetForTransactionEnd ${d.decoderResetForTransactionEnd}`,
    `openedRequested ${d.openedRequestedVideoFrames} (presentation asked)`,
    `unresolvedRequested ${d.unresolvedRequestedVideoFrames}`,
    `transactionComplete ${d.transactionComplete}`,
    `pumpSlice ${d.pumpSliceStart}-${d.pumpSliceEnd}`,
    `ptsRegistered ${d.ptsRegistered ? "yes" : "no"}`,
    `waiterActive ${d.ownershipWaiterActive ? "yes" : "no"}`,
    `ownershipRebuilt ${d.ownershipRebuilt ? "yes" : "no"}`,
    `recoveryRebuilding ${d.recoveryRebuilding ? "yes" : "no"}`,
    `ownershipState ${d.ownershipState}`,
    `FINAL_FLUSH ${d.finalFlushAttempted || d.finalFlushArmed ? "yes" : "no"}`,
    `finalFlushArmed ${d.finalFlushArmed ? "yes" : "no"}`,
    `usefulInputExhausted ${d.usefulInputExhausted ? "yes" : "no"}`,
    `decodeQueueHighWater ${d.decodeQueueHighWater}`,
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
