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

export type SampleFate = "PENDING" | "READY" | "RESOLVED" | "DISCARDED_NOT_NEEDED" | "ERROR" | "ABORTED";

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
  /** Next I / ref after the requested sample, or last sample if none. */
  nextRefOrGop: number;
};

/**
 * STEP B — structure-bounded extra submit. Not a lookahead raise.
 * End = min(EOF, max(N+maxReorder+prefetch, next ref/GOP)).
 */
export function pumpMoreSubmitEnd(args: PumpMoreArgs): number {
  const { requested, nextDecode, sampleCount, prefetch, maxReorderSamples, nextRefOrGop } = args;
  if (sampleCount <= 0) return -1;
  const hi = sampleCount - 1;
  const structural = requested + Math.max(0, maxReorderSamples | 0) + Math.max(1, prefetch | 0);
  const bound = Math.min(hi, Math.max(structural, nextRefOrGop | 0, requested));
  return Math.max(nextDecode - 1, bound);
}

/** FINAL_FLUSH is legal only at the last requested sample or when input is exhausted. */
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
    `submitted ${d.lastSubmittedSample}`,
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
    `videoReq ${d.videoFramesRequested}`,
    `videoDec ${d.videoFramesDecoded}`,
    `videoEnc ${d.videoFramesEncoded}`,
    `stalledMs ${d.stalledMs}`,
  ].join("; ");
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
