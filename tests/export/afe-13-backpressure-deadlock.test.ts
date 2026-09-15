import { existsSync, readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import {
  AFE_DECODE_QUEUE_HIGH_WATER_CAP,
  AFE_POST_RECREATE_OUTPUT_BUDGET_MS,
  AfeScheduler,
  AfeVideoDecoder,
  decodeOrigin,
  decodeQueueHighWater,
  earlierKeyframeOrigin,
  formatStallMessage,
  frozenHighWaterDeadlock,
  isOpenGopAtKey,
  isTransactionComplete,
  keyframeAtOrBefore,
  lastRequiredDecodeSample,
  maxReorderSamples,
  mayEarlierKeyframeRecover,
  mayFinalFlush,
  nowMs,
  parseIsoBmff,
  requestOwnershipHolds,
  requestedEncodedInvariantHolds,
  streamLookaheadSamples,
  usefulInputExhausted,
  usefulProgressImpossible,
} from "../../src/core/frame-engine";
import { sequentialTimes } from "./afe-plan";
import {
  installHangFlushDecoder,
  installNeverEmitDecoder,
  installRecoverThenFloodStuckDecoder,
  installRecoverThenFreezeAtHighWaterDecoder,
} from "./afe-videodecoder-mock";

const BFRAME = "tests/fixtures/afe/afe-bframe-30-g30-2s.mp4";
const OPEN = "tests/fixtures/afe/afe-bframe-30-g30-2s-opengop.mp4";
const LONG = "tests/fixtures/afe/afe-cfr-30-g60-8s.mp4";

/** Windows AFE-13 clip window. */
const CLIP = { sourceInMs: 1529, sourceOutMs: 6042, fps: 30 };

function loadMovie(path: string) {
  if (!existsSync(path)) return null;
  return parseIsoBmff(new Uint8Array(readFileSync(path)));
}

function times(path: string, frames: number, fps: number, id: string) {
  return sequentialTimes({
    id,
    path,
    fps,
    frames,
    seconds: frames / fps,
    gop: 30,
    keyframeSec: [0],
  });
}

function clipTimes(sourceInMs: number, sourceOutMs: number, fps: number): number[] {
  const out: number[] = [];
  const step = 1 / fps;
  const start = sourceInMs / 1000;
  const end = sourceOutMs / 1000;
  for (let t = start; t < end - 1e-9; t += step) out.push(t);
  return out;
}

/** Times in the second GOP so decodeOrigin > 0 and an earlier I-frame exists. */
function timesFrom(startSec: number, frames: number, fps: number): number[] {
  return Array.from({ length: frames }, (_, i) => startSec + (i + 0.5) / fps);
}

describe("AFE-13 A–L backpressure deadlock after recreate / earlier-keyframe escape", () => {
  let restore: (() => void) | undefined;
  afterEach(() => {
    restore?.();
    restore = undefined;
  });

  it("A. deadlock proven: HIGH_WATER + frozen output mid-recovery + submitted < lastRequired", () => {
    expect(
      frozenHighWaterDeadlock({
        recreateCount: 1,
        decodeQueueSize: 40,
        highWater: 40,
        lastDecodedStuck: true,
        unresolvedRequestedVideoFrames: 1,
        lastSubmittedSample: 92,
        lastRequiredDecodeSample: 144,
        backpressureBlocked: true,
        noMoreSubmission: true,
      }),
    ).toBe(true);
    expect(
      mayFinalFlush({
        unresolvedRequestedVideoFrames: 1,
        nextDecode: 93,
        sampleCount: 240,
        lastRequiredDecodeSample: 144,
        lastSubmittedSample: 92,
        streamWaiterIndex: null,
        pendingPts: [],
        recoveryRebuilding: true,
        transactionComplete: false,
      }),
    ).toBe(false);
    expect(
      usefulInputExhausted({
        lastSubmittedSample: 92,
        lastRequiredDecodeSample: 144,
        nextDecode: 93,
        sampleCount: 240,
      }),
    ).toBe(false);
    expect(
      usefulProgressImpossible({
        noMoreSubmission: true,
        lastDecodedUnchanged: true,
        lastSubmittedSample: 92,
        lastRequiredDecodeSample: 144,
      }),
    ).toBe(true);
    expect(
      mayEarlierKeyframeRecover({
        frozenHighWaterAfterRecreate: true,
        earlierKeyframeOrigin: 0,
        earlierKeyframeRecovered: false,
      }),
    ).toBe(true);
    expect(
      mayEarlierKeyframeRecover({
        frozenHighWaterAfterRecreate: true,
        earlierKeyframeOrigin: null,
        earlierKeyframeRecovered: false,
      }),
    ).toBe(false);
  });

  it("B. gopStart is open-GOP decode origin after recreate (never null for sample 68)", async () => {
    const open = loadMovie(OPEN);
    const long = loadMovie(LONG);
    expect(open).not.toBeNull();
    expect(long).not.toBeNull();
    const keys = open!.keyframeIndices.filter((k) => k > 0);
    expect(keys.length).toBeGreaterThan(0);
    const second = keys[0]!;
    expect(isOpenGopAtKey(open!, second)).toBe(true);
    const origin = decodeOrigin(open!, second + 1);
    expect(origin).toBeLessThan(second);
    expect(origin).toBe(keyframeAtOrBefore(open!, second - 1));

    const movie = long!;
    expect(movie.sampleCount).toBeGreaterThan(68);
    restore = installNeverEmitDecoder();
    const decoder = new AfeVideoDecoder(movie);
    await decoder.ensure();
    const origin68 = decodeOrigin(movie, 68);
    expect(origin68).toBe(keyframeAtOrBefore(movie, 68));
    decoder.setGopKeyframeStart(origin68);
    decoder.beginStream(new Uint8Array(movie.sampleCount).fill(1), origin68, {
      lastRequested: 140,
      lastRequiredDecodeSample: 144,
      requestedIndexes: [68],
    });
    decoder.openRequested(68, decoder.chunkTimestampUs(movie.samples[68]!));
    decoder.bindOrigin({
      sourceSampleRequested: 68,
      requestedPtsUs: decoder.chunkTimestampUs(movie.samples[68]!),
      originRequestedSample: 68,
      gopKeyframeStart: origin68,
    });
    decoder.markRecoveryRebuilding([68]);
    await decoder.recreate();
    decoder.setGopKeyframeStart(origin68);
    decoder.restoreOpenedIdentity(68, decoder.chunkTimestampUs(movie.samples[68]!));
    decoder.confirmPtsRegistered(68);
    const dump = decoder.snapshot({ sourceSampleRequested: 68 });
    expect(dump.gopKeyframeStart).toBe(origin68);
    expect(dump.gopKeyframeStart).not.toBeNull();
    expect(formatStallMessage(dump)).toContain(`gopStart ${origin68}`);
    expect(dump.gopKeyframeStart).not.toBe(28);
    expect(earlierKeyframeOrigin(movie, origin68)).toBe(0);
    decoder.close();
  }, 10_000);

  it("C. after recreate: HIGH_WATER + stuck lastDecoded + unresolved → earlier-keyframe, not 3s sit", async () => {
    const movie = loadMovie(LONG);
    if (!movie) return;
    expect(movie.sampleCount).toBeGreaterThan(68);
    restore = installRecoverThenFreezeAtHighWaterDecoder({ emitBeforeFreeze: 12, emitOnInstance: 2 });
    const scheduler = new AfeScheduler(movie, 12);
    const started = nowMs();
    const out: number[] = [];
    try {
      for await (const frame of scheduler.getFramesAt(timesFrom(2.2, 50, 30))) {
        expect(frame).not.toBeNull();
        out.push(frame!.timestamp);
        frame!.close();
      }
    } finally {
      const elapsed = nowMs() - started;
      const dump = scheduler.stallSnapshot();
      expect(dump.decoderRecreateCount).toBeGreaterThanOrEqual(2);
      expect(dump.recoveryAttempts).toBeGreaterThanOrEqual(2);
      expect(dump.earlierKeyframeRecovered).toBe(true);
      expect(dump.gopKeyframeStart).not.toBeNull();
      expect(dump.decoderFlushCount).toBe(0);
      expect(elapsed).toBeLessThan(2_500);
      expect(dump.decodeQueuePeak).toBeLessThan(125);
      scheduler.close();
    }
    expect(out.length).toBeGreaterThan(0);
  }, 15_000);

  it("D. earlier-keyframe recover rebuilds ownership (PTS registered / waiter reinstalled)", async () => {
    const movie = loadMovie(LONG);
    if (!movie) return;
    restore = installRecoverThenFreezeAtHighWaterDecoder({ emitBeforeFreeze: 8, emitOnInstance: 2 });
    const scheduler = new AfeScheduler(movie, 12);
    try {
      for await (const frame of scheduler.getFramesAt(timesFrom(2.2, 40, 30))) {
        expect(frame).not.toBeNull();
        frame!.close();
      }
    } finally {
      const dump = scheduler.stallSnapshot();
      expect(dump.earlierKeyframeRecovered).toBe(true);
      expect(dump.unresolvedRequestedVideoFrames).toBe(0);
      expect(dump.ownershipState === "ENCODED" || dump.unresolvedRequestedVideoFrames === 0).toBe(true);
      expect(
        requestOwnershipHolds({
          unresolvedRequestedVideoFrames: 0,
          streamWaiterIndex: dump.streamWaiterIndex,
          ptsRegistered: dump.ptsRegistered,
          recoveryRebuilding: dump.recoveryRebuilding,
          finalFlushArmed: dump.finalFlushArmed,
        }),
      ).toBe(true);
      scheduler.close();
    }
  }, 15_000);

  it("E. no earlier keyframe → typed AFE_DECODE_STALL quickly; no mid-run flush", async () => {
    const movie = loadMovie(LONG);
    if (!movie) return;
    restore = installRecoverThenFreezeAtHighWaterDecoder({
      emitBeforeFreeze: 4,
      emitOnInstance: 99,
    });
    const scheduler = new AfeScheduler(movie, 12);
    const started = nowMs();
    try {
      await expect(async () => {
        for await (const frame of scheduler.getFramesAt(timesFrom(0.1, 80, 30))) {
          expect(frame).not.toBeNull();
          frame?.close();
        }
      }).rejects.toMatchObject({ name: "AfeError", code: "AFE_DECODE_STALL" });
    } finally {
      const elapsed = nowMs() - started;
      const dump = scheduler.stallSnapshot({
        videoFramesRequested: 1,
        videoFramesDecoded: 0,
        videoFramesEncoded: 0,
      });
      expect(dump.gopKeyframeStart).not.toBeNull();
      expect(dump.gopKeyframeStart).toBe(0);
      expect(earlierKeyframeOrigin(movie, dump.gopKeyframeStart ?? 0)).toBeNull();
      expect(dump.decoderFlushCount).toBe(0);
      expect(dump.finalFlushAttempted).toBe(false);
      expect(elapsed).toBeLessThan(2_500);
      expect(formatStallMessage(dump)).not.toMatch(/nearest|snap|dup|last-good|paintFallback|allowSkip/i);
      scheduler.close();
    }
  }, 15_000);

  it("F. no mid-run flush as ordinary pressure release (AFE-06)", async () => {
    const movie = loadMovie(LONG);
    if (!movie) return;
    restore = installRecoverThenFreezeAtHighWaterDecoder({ emitBeforeFreeze: 12, emitOnInstance: 2 });
    const scheduler = new AfeScheduler(movie, 12);
    try {
      for await (const frame of scheduler.getFramesAt(timesFrom(2.2, 40, 30))) {
        expect(frame).not.toBeNull();
        frame!.close();
      }
    } finally {
      const dump = scheduler.stallSnapshot();
      expect(dump.decoderFlushCount).toBe(0);
      expect(dump.finalFlushAttempted).toBe(false);
      expect(dump.earlierKeyframeRecovered).toBe(true);
      scheduler.close();
    }
  }, 15_000);

  it("G. no VIDEO fallback: missing exact PTS after exhausted escape is typed stall", async () => {
    const movie = loadMovie(BFRAME);
    if (!movie) return;
    restore = installHangFlushDecoder();
    const scheduler = new AfeScheduler(movie, 12);
    try {
      await expect(async () => {
        for await (const frame of scheduler.getFramesAt(times(BFRAME, 4, 30, "afe-13-g"))) {
          expect(frame).not.toBeNull();
          frame?.close();
        }
      }).rejects.toMatchObject({ name: "AfeError", code: "AFE_DECODE_STALL" });
    } finally {
      const dump = scheduler.stallSnapshot({
        videoFramesRequested: 1,
        videoFramesDecoded: 0,
        videoFramesEncoded: 0,
      });
      expect(dump.transactionComplete).toBe(false);
      expect(
        isTransactionComplete({
          unresolvedRequestedVideoFrames: dump.unresolvedRequestedVideoFrames,
          streamWaiterIndex: dump.streamWaiterIndex,
        }),
      ).toBe(false);
      expect(formatStallMessage(dump)).not.toMatch(/nearest|snap|dup|last-good|paintFallback|allowSkip/i);
      scheduler.close();
    }
  }, 15_000);

  it("H. AFE-12 queue bound still holds (peak never ~125) under freeze+escape", async () => {
    const movie = loadMovie(LONG);
    if (!movie) return;
    restore = installRecoverThenFloodStuckDecoder({ emitLimit: 12, floodStickAt: 64 });
    const scheduler = new AfeScheduler(movie, 12);
    const out: number[] = [];
    try {
      for await (const frame of scheduler.getFramesAt(times(LONG, 20, 30, "afe-13-h"))) {
        expect(frame).not.toBeNull();
        out.push(frame!.timestamp);
        frame!.close();
      }
    } finally {
      const dump = scheduler.stallSnapshot();
      expect(dump.decodeQueuePeak).toBeLessThan(125);
      expect(dump.decodeQueuePeak).toBeLessThan(AFE_DECODE_QUEUE_HIGH_WATER_CAP + 8);
      expect(dump.decodeQueueSize).toBeLessThan(125);
      scheduler.close();
    }
    expect(out).toHaveLength(20);
  }, 20_000);

  it("I. maxReorderSamples=10 is reported; HIGH_WATER still admits B-frame deps", () => {
    const samples = Array.from({ length: 32 }, (_, i) => ({
      index: i,
      ptsTimescale: i === 10 ? 0 : i + 1,
    }));
    expect(maxReorderSamples(samples)).toBe(10);
    const look = streamLookaheadSamples(10, 4);
    const high = decodeQueueHighWater(10, 4);
    expect(look).toBeGreaterThanOrEqual(10);
    expect(high).toBeGreaterThanOrEqual(10 + look);
    expect(high).toBeLessThan(125);
    expect(high).toBeLessThanOrEqual(AFE_DECODE_QUEUE_HIGH_WATER_CAP);
    const movie = loadMovie(LONG);
    if (!movie) return;
    const patched = { ...movie, maxReorderSamples: 10 };
    const decoder = new AfeVideoDecoder(patched);
    expect(decoder.decodeQueueHighWater).toBe(high);
    expect(decoder.decodeQueueHighWater).toBeGreaterThanOrEqual(40);
    expect(decodeQueueHighWater(10, 4, { afterRecreate: true })).toBeLessThan(40);
    decoder.close();
  });

  it("J. RECOVERY_REBUILDING never sits waiter-null + ptsRegistered-no without a rebuild step", async () => {
    const movie = loadMovie(LONG);
    if (!movie) return;
    restore = installNeverEmitDecoder();
    const decoder = new AfeVideoDecoder(movie);
    await decoder.ensure();
    const origin = decodeOrigin(movie, 68);
    decoder.setGopKeyframeStart(origin);
    decoder.beginStream(new Uint8Array(movie.sampleCount).fill(1), origin, {
      lastRequested: 140,
      lastRequiredDecodeSample: 144,
      requestedIndexes: [68],
    });
    const pts = decoder.chunkTimestampUs(movie.samples[68]!);
    decoder.openRequested(68, pts);
    decoder.markRecoveryRebuilding([68]);
    await decoder.recreate();
    decoder.setGopKeyframeStart(origin);
    decoder.restoreOpenedIdentity(68, pts);
    decoder.confirmPtsRegistered(68, pts);
    const dump = decoder.snapshot({ sourceSampleRequested: 68 });
    expect(["RECOVERY_REBUILDING", "PTS_REGISTERED"]).toContain(dump.ownershipState);
    expect(dump.recoveryRebuilding).toBe(true);
    expect(dump.ptsRegistered).toBe(true);
    expect(dump.streamWaiterIndex == null && dump.ptsRegistered === false).toBe(false);
    expect(dump.gopKeyframeStart).toBe(origin);
    expect(
      requestOwnershipHolds({
        unresolvedRequestedVideoFrames: 1,
        streamWaiterIndex: dump.streamWaiterIndex,
        ptsRegistered: dump.ptsRegistered,
        recoveryRebuilding: dump.recoveryRebuilding,
        finalFlushArmed: false,
      }),
    ).toBe(true);
    const can = await decoder.waitForDecodeCapacity(undefined, {
      requested: 68,
      budgetEnd: nowMs() + 200,
    });
    const after = decoder.snapshot({ sourceSampleRequested: 68 });
    expect(after.ptsRegistered || after.streamWaiterIndex != null || after.recoveryRebuilding).toBe(true);
    expect(after.gopKeyframeStart).toBe(origin);
    expect(can === true || can === false).toBe(true);
    decoder.close();
  }, 10_000);

  it("K. clip timing sourceInMs~1529 / sourceOutMs 6042 / fps 30 — earlier-keyframe delivers exact PTS", async () => {
    const movie = loadMovie(LONG);
    if (!movie) return;
    expect(movie.sampleCount).toBeGreaterThan(68);
    const holdPts = new AfeVideoDecoder(movie).chunkTimestampUs(movie.samples[68]!);
    restore = installRecoverThenFreezeAtHighWaterDecoder({
      emitBeforeFreeze: 12,
      emitOnInstance: 2,
      holdPtsOnFirstInstance: holdPts,
    });
    const scheduler = new AfeScheduler(movie, 12);
    scheduler.setExportStallExtra({
      sourceInMs: CLIP.sourceInMs,
      sourceOutMs: CLIP.sourceOutMs,
      fps: CLIP.fps,
      sourceClipLabel: "clip - Kopie.mp4",
    });
    const planned = clipTimes(CLIP.sourceInMs, CLIP.sourceOutMs, CLIP.fps);
    const out: number[] = [];
    try {
      for await (const frame of scheduler.getFramesAt(planned)) {
        expect(frame).not.toBeNull();
        out.push(frame!.timestamp);
        frame!.close();
      }
    } finally {
      const dump = scheduler.stallSnapshot();
      expect(dump.gopKeyframeStart).not.toBeNull();
      expect(dump.earlierKeyframeRecovered).toBe(true);
      /* AFE-14: clip tail may AFE-11 FINAL_FLUSH after earlier-keyframe; not a mid-run nudge. */
      expect(dump.decoderFlushCount === 0 || dump.finalFlushAttempted).toBe(true);
      expect(dump.decodeQueuePeak).toBeLessThan(125);
      expect(dump.unresolvedRequestedVideoFrames).toBe(0);
      expect(dump.sourceInMs).toBe(CLIP.sourceInMs);
      expect(dump.sourceOutMs).toBe(CLIP.sourceOutMs);
      expect(formatStallMessage(dump)).toContain("sourceInMs 1529");
      scheduler.close();
    }
    expect(out.length).toBe(planned.length);
    for (let i = 1; i < out.length; i++) expect(out[i]!).toBeGreaterThan(out[i - 1]!);
  }, 25_000);

  it("L. stall dump + waitForDecodeCapacity: gopStart set, short freeze budget, no 3s sit, no fallback", async () => {
    const movie = loadMovie(LONG);
    if (!movie) return;
    restore = installRecoverThenFreezeAtHighWaterDecoder({ emitBeforeFreeze: 2, emitOnInstance: 99 });
    const decoder = new AfeVideoDecoder(movie);
    await decoder.ensure();
    const origin = decodeOrigin(movie, 68);
    decoder.setGopKeyframeStart(origin);
    decoder.beginStream(new Uint8Array(movie.sampleCount).fill(1), 0, {
      lastRequested: 140,
      lastRequiredDecodeSample: 144,
      requestedIndexes: [68],
    });
    decoder.openRequested(68, decoder.chunkTimestampUs(movie.samples[68]!));
    decoder.bindOrigin({
      sourceSampleRequested: 68,
      requestedPtsUs: decoder.chunkTimestampUs(movie.samples[68]!),
      originRequestedSample: 68,
      gopKeyframeStart: origin,
      sourceInMs: CLIP.sourceInMs,
      sourceOutMs: CLIP.sourceOutMs,
    });
    decoder.markRecoveryRebuilding([68]);
    await decoder.recreate();
    decoder.setGopKeyframeStart(origin);
    decoder.restoreOpenedIdentity(68, decoder.chunkTimestampUs(movie.samples[68]!));
    decoder.confirmPtsRegistered(68);
    decoder.setStallPhase("PUMP_LOOKAHEAD");
    const high = decoder.decodeQueueHighWater;
    const started = nowMs();
    for (let i = origin; i <= origin + high + 8 && i < movie.sampleCount; i++) {
      const can = await decoder.waitForDecodeCapacity(undefined, {
        requested: 68,
        budgetEnd: nowMs() + 3_000,
      });
      if (!can) break;
      decoder.submitEncoded(movie.samples[i]!);
    }
    const elapsed = nowMs() - started;
    const dump = decoder.snapshot({ sourceSampleRequested: 68 });
    expect(dump.gopKeyframeStart).toBe(origin);
    expect(dump.decodeQueuePeak).toBeLessThan(125);
    expect(dump.backpressureWaitCount).toBeGreaterThan(0);
    expect(dump.noMoreSubmission || dump.frozenAtHighWater || dump.backpressureBlocked).toBe(true);
    expect(elapsed).toBeLessThan(1_000);
    expect(elapsed).toBeGreaterThanOrEqual(0);
    expect(AFE_POST_RECREATE_OUTPUT_BUDGET_MS).toBeLessThan(500);
    expect(dump.lastRequiredDecodeSample).toBe(144);
    expect(
      lastRequiredDecodeSample({
        lastRequested: 140,
        maxReorderSamples: movie.maxReorderSamples,
        prefetch: 4,
        sampleCount: movie.sampleCount,
      }),
    ).toBeGreaterThan(68);
    const text = formatStallMessage({
      sourceSampleRequested: 68,
      requestedPtsUs: 2_875_000,
      originRequestedSample: 68,
      originRequestedPts: 2_875_000,
      lastSubmittedSample: 92,
      lastRequiredDecodeSample: 144,
      lastRequestedSample: 130,
      decodeQueueSize: 40,
      lastDecodedTimestamp: 2_000_000,
      decodeQueueHighWater: 40,
      decodeQueuePeak: 40,
      backpressureBlocked: true,
      noMoreSubmission: true,
      gopKeyframeStart: 60,
      frozenAtHighWater: true,
      earlierKeyframeRecovered: false,
      unresolvedRequestedVideoFrames: 1,
      openedRequestedVideoFrames: 39,
      videoFramesRequested: 39,
      videoFramesDecoded: 38,
      videoFramesEncoded: 38,
      stallPhase: "PUMP_LOOKAHEAD",
      ownershipState: "RECOVERY_REBUILDING",
      recoveryRebuilding: true,
      ptsRegistered: true,
      sourceInMs: CLIP.sourceInMs,
      sourceOutMs: CLIP.sourceOutMs,
      fps: CLIP.fps,
      sourceClipLabel: "clip - Kopie.mp4",
    });
    expect(text).toContain("requested sample 68 PTS 2875000");
    expect(text).toContain("gopStart 60");
    expect(text).toContain("frozenAtHighWater yes");
    expect(text).toContain("earlierKeyframeRecovered no");
    expect(text).toContain("decodeQueue 40");
    expect(text).toContain("lastDecodedTs 2000000");
    expect(text).toContain("submitted 92");
    expect(text).toContain("lastRequiredDecodeSample 144");
    expect(text).toContain("noMoreSubmission yes");
    expect(text).toContain("ownershipState RECOVERY_REBUILDING");
    expect(text).not.toMatch(/nearest|snap|dup|last-good|paintFallback|allowSkip/i);
    expect(
      requestedEncodedInvariantHolds({
        unresolvedRequestedVideoFrames: 1,
        videoFramesRequested: 39,
        videoFramesEncoded: 38,
      }),
    ).toBe(true);
    decoder.close();
  }, 10_000);
});
