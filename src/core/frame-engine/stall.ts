/**
 * AFE-05 — B-frame export stall diagnostics + submit-ahead math.
 *
 * WebCodecs (especially WebView2 hardware decode) may hold frame N until
 * future decode-order samples N+k arrive. Waiting for N without submitting
 * N+k is a deadlock. Timeout is fail-closed, not the fix.
 */

export const AFE_DECODE_STALL_MS = 3000;
/** No-progress window before one releaseHeld() nudge. Do not raise prefetch instead. */
export const AFE_STALL_NUDGE_MS = 200;
/** Brief wait after the single nudge before skip-or-stall. */
export const AFE_STALL_NUDGE_WAIT_MS = 250;
/** Cap queue-drain spin so Shape Q (held decodeQueue) can still reach flush(). */
export const AFE_SETTLE_DRAIN_MS = 80;

export type SampleFate = "PENDING" | "RESOLVED" | "DISCARDED_NOT_NEEDED" | "ERROR" | "ABORTED";

export type AfeDumpPictureKind = "vis" | "video" | "black";

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
  encoderEncodeQueueSize: number | null;
  lastProgressUpdateMs: number | null;
  pendingPts: number[];
  readyIndexes: number[];
  lastDecodedTimestamp: number | null;
  gopKeyframeStart: number | null;
  stalledMs: number;
  lookahead: number;
  maxReorderSamples: number;
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
    encoderEncodeQueueSize: null,
    lastProgressUpdateMs: null,
    pendingPts: [],
    readyIndexes: [],
    lastDecodedTimestamp: null,
    gopKeyframeStart: null,
    stalledMs: 0,
    lookahead: 0,
    maxReorderSamples: 0,
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

export function formatStallMessage(dump: AfeStallSnapshot): string {
  const clip = dump.sourceClipLabel ?? dump.sourceClipId;
  return [
    `requested sample ${dump.sourceSampleRequested} PTS ${dump.requestedPtsUs}`,
    `pending PTS [${dump.pendingPts.join(",")}]`,
    `ready [${dump.readyIndexes.join(",")}]`,
    `decodeQueue ${dump.decodeQueueSize}`,
    `lastDecodedTs ${dump.lastDecodedTimestamp}`,
    `gopStart ${dump.gopKeyframeStart}`,
    `submitted ${dump.lastSubmittedSample}`,
    `decodeStart ${dump.decodeStartSample}`,
    `waiter ${dump.streamWaiterIndex}`,
    `streamPts ${dump.streamPtsPending}`,
    `streamReady ${dump.streamReadySize}`,
    `reorderCap ${dump.reorderCap}`,
    `lookahead ${dump.lookahead}`,
    `flushes ${dump.decoderFlushCount}`,
    `resets ${dump.decoderResetCount}`,
    `encoderQ ${dump.encoderEncodeQueueSize}`,
    `exportFrame ${dump.exportFrameIndex}`,
    `clip ${clip}`,
    `clipId ${dump.sourceClipId}`,
    `source ${dump.sourceUrlName}`,
    `sourceInMs ${dump.sourceInMs}`,
    `sourceOutMs ${dump.sourceOutMs}`,
    `timelineMs ${dump.timelineMs}`,
    `picture ${dump.pictureKind}`,
    `fps ${dump.fps}`,
    `visFrames ${dump.visFrames}`,
    `afeFrames ${dump.afeFrames}`,
    `blackFrames ${dump.blackFrames}`,
    `stalledMs ${dump.stalledMs}`,
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
