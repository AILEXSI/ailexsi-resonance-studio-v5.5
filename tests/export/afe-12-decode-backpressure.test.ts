import { existsSync, readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import {
  AFE_DECODE_QUEUE_HIGH_WATER_CAP,
  AFE_DECODE_QUEUE_RECOVERY_FILL,
  AfeScheduler,
  AfeVideoDecoder,
  decodeQueueHighWater,
  formatStallMessage,
  isTransactionComplete,
  lastRequiredDecodeSample,
  mayFinalFlush,
  maySubmitEncoded,
  noMoreSubmissionRequired,
  nowMs,
  parseIsoBmff,
  requestOwnershipHolds,
  requestedEncodedInvariantHolds,
  streamLookaheadSamples,
  usefulInputExhausted,
} from "../../src/core/frame-engine";
import { sequentialTimes } from "./afe-plan";
import {
  installEmitThenHoldFloodDecoder,
  installHangFlushDecoder,
  installNeverEmitDecoder,
  installRecoverThenFloodStuckDecoder,
} from "./afe-videodecoder-mock";

const BFRAME = "tests/fixtures/afe/afe-bframe-30-g30-2s.mp4";
const LONG = "tests/fixtures/afe/afe-cfr-30-g60-8s.mp4";

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

describe("AFE-12 A–L WebCodecs decodeQueue backpressure / queue progress", () => {
  let restore: (() => void) | undefined;
  afterEach(() => {
    restore?.();
    restore = undefined;
  });

  it("A. hypothesis proven: unbounded submit reaches submitted140 / queue>=125 / lastDecoded stuck, no capacity wait", async () => {
    const movie = loadMovie(LONG);
    if (!movie) return;
    expect(movie.sampleCount).toBeGreaterThan(140);
    restore = installEmitThenHoldFloodDecoder(12);
    const decoder = new AfeVideoDecoder(movie);
    await decoder.ensure();
    decoder.beginStream(new Uint8Array(movie.sampleCount).fill(1), 0, {
      lastRequested: 140,
      lastRequiredDecodeSample: 140,
      requestedIndexes: [38],
    });
    decoder.openRequested(38, decoder.chunkTimestampUs(movie.samples[38]!));
    decoder.bindOrigin({
      sourceSampleRequested: 38,
      requestedPtsUs: decoder.chunkTimestampUs(movie.samples[38]!),
      originRequestedSample: 38,
      originRequestedPts: decoder.chunkTimestampUs(movie.samples[38]!),
    });
    decoder.beginSubmitPhase("PUMP_LOOKAHEAD", 0);
    for (let i = 0; i <= 140; i++) decoder.submitEncoded(movie.samples[i]!);
    decoder.endSubmitPhase();
    const dump = decoder.snapshot();
    expect(dump.lastSubmittedSample).toBe(140);
    expect(dump.decodeQueueSize).toBeGreaterThanOrEqual(125);
    expect(dump.lastDecodedTimestamp).toBe(decoder.chunkTimestampUs(movie.samples[11]!));
    expect(dump.backpressureWaitCount).toBe(0);
    expect(dump.backpressureBlocked).toBe(false);
    expect(dump.submitsWithoutOutputProgress).toBeGreaterThanOrEqual(125);
    expect(dump.submitPhaseTraces.length).toBeGreaterThan(0);
    expect(dump.submitPhaseTraces[0]!.decodeQueueEnd).toBeGreaterThanOrEqual(125);
    expect(dump.submitPhaseTraces[0]!.pausedForCapacity).toBe(false);
    decoder.close();
  }, 10_000);

  it("B. HIGH_WATER = min(CAP, max(RECOVERY_FILL, maxReorder+lookahead+bFrameNeed)); never near 125", () => {
    const look2 = streamLookaheadSamples(2, 4);
    const raw2 = 2 + look2 + look2 + 4;
    expect(decodeQueueHighWater(2, 4)).toBe(
      Math.min(AFE_DECODE_QUEUE_HIGH_WATER_CAP, Math.max(AFE_DECODE_QUEUE_RECOVERY_FILL, raw2)),
    );
    expect(decodeQueueHighWater(2, 4)).toBe(AFE_DECODE_QUEUE_RECOVERY_FILL);
    expect(decodeQueueHighWater(2, 4)).toBeLessThan(50);
    expect(decodeQueueHighWater(2, 4)).not.toBeGreaterThanOrEqual(125);
    const look16 = streamLookaheadSamples(16, 4);
    const raw16 = 16 + look16 + look16 + 4;
    expect(decodeQueueHighWater(16, 4)).toBe(
      Math.min(AFE_DECODE_QUEUE_HIGH_WATER_CAP, Math.max(AFE_DECODE_QUEUE_RECOVERY_FILL, raw16)),
    );
    expect(decodeQueueHighWater(16, 4)).toBe(AFE_DECODE_QUEUE_HIGH_WATER_CAP);
    expect(decodeQueueHighWater(0, 4)).toBe(AFE_DECODE_QUEUE_RECOVERY_FILL);
    expect(AFE_DECODE_QUEUE_HIGH_WATER_CAP).toBe(48);
    expect(AFE_DECODE_QUEUE_RECOVERY_FILL).toBe(40);
    expect(AFE_DECODE_QUEUE_HIGH_WATER_CAP).toBeLessThan(125);
  });

  it("C. INVARIANT: no output progress + queue>=HIGH_WATER => NO_MORE_SUBMISSION", () => {
    const high = decodeQueueHighWater(2, 4);
    expect(high).toBeGreaterThan(0);
    expect(high).toBeLessThan(125);
    expect(
      maySubmitEncoded({ decodeQueueSize: high - 1, highWater: high, outputProgressed: false }),
    ).toBe(true);
    expect(
      maySubmitEncoded({ decodeQueueSize: high, highWater: high, outputProgressed: true }),
    ).toBe(true);
    expect(
      maySubmitEncoded({ decodeQueueSize: high, highWater: high, outputProgressed: false }),
    ).toBe(false);
    expect(
      maySubmitEncoded({ decodeQueueSize: 125, highWater: high, outputProgressed: false }),
    ).toBe(false);
    expect(
      noMoreSubmissionRequired({ decodeQueueSize: 125, highWater: high, outputProgressed: false }),
    ).toBe(true);
    expect(
      noMoreSubmissionRequired({ decodeQueueSize: high, highWater: high, outputProgressed: true }),
    ).toBe(false);
  });

  it("D. waitForDecodeCapacity pauses at HIGH_WATER; no more submit until progress or typed stall", async () => {
    const movie = loadMovie(LONG);
    if (!movie) return;
    restore = installEmitThenHoldFloodDecoder(12);
    const decoder = new AfeVideoDecoder(movie);
    await decoder.ensure();
    decoder.beginStream(new Uint8Array(movie.sampleCount).fill(1), 0, {
      lastRequested: 140,
      lastRequiredDecodeSample: 140,
      requestedIndexes: [38],
    });
    decoder.openRequested(38, decoder.chunkTimestampUs(movie.samples[38]!));
    decoder.setStallPhase("PUMP_LOOKAHEAD");
    decoder.beginSubmitPhase("PUMP_LOOKAHEAD", 0);
    const high = decoder.decodeQueueHighWater;
    let submitted = -1;
    let blocked = false;
    for (let i = 0; i <= 140; i++) {
      const canSubmit = await decoder.waitForDecodeCapacity(undefined, {
        requested: 38,
        budgetEnd: nowMs() + 200,
      });
      if (!canSubmit) {
        blocked = true;
        break;
      }
      decoder.submitEncoded(movie.samples[i]!);
      submitted = i;
    }
    decoder.endSubmitPhase();
    const dump = decoder.snapshot();
    expect(dump.backpressureWaitCount).toBeGreaterThan(0);
    expect(dump.decodeQueuePeak).toBeLessThan(125);
    expect(dump.decodeQueueSize).toBeLessThan(125);
    expect(submitted).toBeLessThan(140);
    expect(submitted).toBeGreaterThanOrEqual(high - 1);
    expect(blocked || dump.noMoreSubmission).toBe(true);
    expect(dump.lastSubmittedSample).toBeLessThan(140);
    decoder.close();
  }, 10_000);

  it("E. after recreate: origin/keyframe, exact request, PTS ownership, decode-order pump, backpressure, stop on exact PTS", async () => {
    const movie = loadMovie(BFRAME);
    if (!movie) return;
    restore = installRecoverThenFloodStuckDecoder({ emitLimit: 12, floodStickAt: 64 });
    const scheduler = new AfeScheduler(movie, 12);
    const out: number[] = [];
    try {
      for await (const frame of scheduler.getFramesAt(times(BFRAME, 8, 30, "afe-12-e"))) {
        expect(frame).not.toBeNull();
        out.push(frame!.timestamp);
        frame!.close();
      }
    } finally {
      const dump = scheduler.stallSnapshot();
      expect(dump.decoderRecreateCount).toBeGreaterThanOrEqual(1);
      expect(dump.decodeQueuePeak).toBeLessThan(125);
      expect(dump.decodeQueueSize).toBeLessThan(AFE_DECODE_QUEUE_HIGH_WATER_CAP + 8);
      expect(dump.decoderFlushCount).toBe(0);
      expect(dump.unresolvedRequestedVideoFrames).toBe(0);
      expect(dump.lastSubmittedSample).not.toBeNull();
      expect((dump.lastSubmittedSample ?? 0) <= (dump.lastRequiredDecodeSample ?? 0)).toBe(true);
      scheduler.close();
    }
    expect(out).toHaveLength(8);
    for (let i = 1; i < out.length; i++) expect(out[i]!).toBeGreaterThan(out[i - 1]!);
  }, 15_000);

  it("F. flood-stuck long run never begins FINAL_FLUSH with queue~125", async () => {
    const movie = loadMovie(LONG);
    if (!movie) return;
    restore = installRecoverThenFloodStuckDecoder({ emitLimit: 12, floodStickAt: 64 });
    const scheduler = new AfeScheduler(movie, 12);
    const out: number[] = [];
    try {
      for await (const frame of scheduler.getFramesAt(times(LONG, 50, 30, "afe-12-f"))) {
        expect(frame).not.toBeNull();
        out.push(frame!.timestamp);
        frame!.close();
      }
    } finally {
      const dump = scheduler.stallSnapshot();
      expect(dump.decodeQueuePeak).toBeLessThan(125);
      expect(dump.decodeQueueSize).toBeLessThan(125);
      if (dump.finalFlushAttempted) {
        expect(dump.decodeQueueSize).toBeLessThan(AFE_DECODE_QUEUE_HIGH_WATER_CAP + 4);
      }
      expect(dump.lastSubmittedSample ?? 0).toBeLessThan(125);
      scheduler.close();
    }
    expect(out).toHaveLength(50);
  }, 20_000);

  it("G. FINAL_FLUSH AFE-11 intact: still requires useful-input exhausted, not mid-run", () => {
    expect(
      mayFinalFlush({
        unresolvedRequestedVideoFrames: 1,
        nextDecode: 45,
        sampleCount: 141,
        lastRequiredDecodeSample: 140,
        lastSubmittedSample: 44,
        streamWaiterIndex: null,
        pendingPts: [],
        recoveryRebuilding: false,
        transactionComplete: false,
      }),
    ).toBe(false);
    expect(
      usefulInputExhausted({
        lastSubmittedSample: 140,
        lastRequiredDecodeSample: 140,
        nextDecode: 141,
        sampleCount: 141,
      }),
    ).toBe(true);
    expect(
      mayFinalFlush({
        unresolvedRequestedVideoFrames: 1,
        nextDecode: 141,
        sampleCount: 141,
        lastRequiredDecodeSample: 140,
        lastSubmittedSample: 140,
        streamWaiterIndex: null,
        pendingPts: [],
        recoveryRebuilding: false,
        transactionComplete: false,
      }),
    ).toBe(true);
    expect(
      mayFinalFlush({
        unresolvedRequestedVideoFrames: 1,
        nextDecode: 141,
        sampleCount: 141,
        lastRequiredDecodeSample: 140,
        lastSubmittedSample: 140,
        streamWaiterIndex: 38,
      }),
    ).toBe(false);
  });

  it("H. no mid-run flush nudge while capacity-aware pump is running", async () => {
    const movie = loadMovie(BFRAME);
    if (!movie) return;
    restore = installRecoverThenFloodStuckDecoder({ emitLimit: 12, floodStickAt: 64 });
    const scheduler = new AfeScheduler(movie, 12);
    try {
      for await (const frame of scheduler.getFramesAt(times(BFRAME, 6, 30, "afe-12-h"))) {
        expect(frame).not.toBeNull();
        frame!.close();
      }
    } finally {
      const dump = scheduler.stallSnapshot();
      expect(dump.decoderFlushCount).toBe(0);
      expect(dump.finalFlushAttempted).toBe(false);
      scheduler.close();
    }
  }, 15_000);

  it("I. CANCEL / ownership: unresolved exact request is not reset by backpressure diagnostics", async () => {
    const movie = loadMovie(BFRAME);
    if (!movie) return;
    restore = installNeverEmitDecoder();
    const decoder = new AfeVideoDecoder(movie);
    await decoder.ensure();
    decoder.beginStream(new Uint8Array(movie.sampleCount).fill(1), 0, {
      lastRequested: 5,
      lastRequiredDecodeSample: lastRequiredDecodeSample({
        lastRequested: 5,
        maxReorderSamples: movie.maxReorderSamples,
        prefetch: 4,
        sampleCount: movie.sampleCount,
      }),
      requestedIndexes: [3],
    });
    decoder.openRequested(3, decoder.chunkTimestampUs(movie.samples[3]!));
    decoder.bindOrigin({
      sourceSampleRequested: 3,
      requestedPtsUs: decoder.chunkTimestampUs(movie.samples[3]!),
      originRequestedSample: 3,
      originRequestedPts: decoder.chunkTimestampUs(movie.samples[3]!),
    });
    decoder.confirmPtsRegistered(3);
    expect(decoder.unresolvedRequestedCount()).toBe(1);
    decoder.assertOpenedOwnership({ sourceSampleRequested: 3 });
    expect(decoder.ownershipTrace(3)).not.toContain("OWNERSHIP_LOST");
    expect(decoder.ownershipTrace(3)).not.toContain("ABORTED");
    expect(
      requestOwnershipHolds({
        unresolvedRequestedVideoFrames: 1,
        ptsRegistered: true,
        streamWaiterIndex: null,
        recoveryRebuilding: false,
        finalFlushArmed: false,
      }),
    ).toBe(true);
    decoder.close();
  }, 10_000);

  it("J. no VIDEO fallback: missing exact PTS after capacity stall is typed AFE_DECODE_STALL", async () => {
    const movie = loadMovie(BFRAME);
    if (!movie) return;
    restore = installHangFlushDecoder();
    const scheduler = new AfeScheduler(movie, 12);
    try {
      await expect(async () => {
        for await (const frame of scheduler.getFramesAt(times(BFRAME, 6, 30, "afe-12-j"))) {
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
      expect(dump.unresolvedRequestedVideoFrames).toBeGreaterThan(0);
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

  it("K. stall dump includes per-phase + aggregate backpressure diagnostics", () => {
    const text = formatStallMessage({
      sourceSampleRequested: 38,
      requestedPtsUs: 1_625_000,
      originRequestedSample: 38,
      originRequestedPts: 1_625_000,
      lastSubmittedSample: 140,
      lastRequiredDecodeSample: 140,
      lastRequestedSample: 140,
      decodeQueueSize: 125,
      lastDecodedTimestamp: 458_333,
      decodeQueueHighWater: 40,
      decodeQueuePeak: 125,
      submitsWithoutOutputProgress: 125,
      backpressureWaitCount: 0,
      backpressureBlocked: false,
      noMoreSubmission: false,
      lastOutputProgressTimestamp: 458_333,
      submitPhaseTraces: [
        {
          phase: "PUMP_LOOKAHEAD",
          submittedFrom: 0,
          submittedTo: 140,
          decodeQueueStart: 0,
          decodeQueueEnd: 125,
          lastDecodedStart: 458_333,
          lastDecodedEnd: 458_333,
          pausedForCapacity: false,
          outputProgressed: false,
        },
      ],
      unresolvedRequestedVideoFrames: 1,
      openedRequestedVideoFrames: 47,
      videoFramesRequested: 47,
      videoFramesDecoded: 46,
      videoFramesEncoded: 46,
      stallPhase: "FINAL_FLUSH",
      finalFlushAttempted: true,
      finalFlushArmed: true,
      usefulInputExhausted: true,
      ownershipRebuilt: true,
      ptsRegistered: true,
      transactionComplete: false,
    });
    expect(text).toContain("requested sample 38 PTS 1625000");
    expect(text).toContain("decodeQueue 125");
    expect(text).toContain("lastDecodedTs 458333");
    expect(text).toContain("submitted 140");
    expect(text).toContain("lastRequiredDecodeSample 140 (sample-index)");
    expect(text).toContain("decodeQueueHighWater 40");
    expect(text).toContain("decodeQueuePeak 125");
    expect(text).toContain("submitsWithoutOutputProgress 125");
    expect(text).toContain("backpressureWaits 0");
    expect(text).toContain("backpressureBlocked no");
    expect(text).toContain("noMoreSubmission no");
    expect(text).toContain("lastOutputProgressTs 458333");
    expect(text).toContain("submitPhases PUMP_LOOKAHEAD:0-140/q0->125/ts458333->458333");
    expect(text).toContain("FINAL_FLUSH yes");
    expect(text).toContain("unresolvedRequested 1");
    expect(text).not.toMatch(/nearest|snap|dup|last-good|paintFallback|allowSkip/i);
  });

  it("L. bounded producer/consumer: flood-stuck decoder yields exact frames when queue stays under HIGH_WATER", async () => {
    const movie = loadMovie(LONG);
    if (!movie) return;
    restore = installRecoverThenFloodStuckDecoder({ emitLimit: 12, floodStickAt: 64 });
    const scheduler = new AfeScheduler(movie, 12);
    const out: number[] = [];
    try {
      for await (const frame of scheduler.getFramesAt(times(LONG, 20, 30, "afe-12-l"))) {
        expect(frame).not.toBeNull();
        out.push(frame!.timestamp);
        frame!.close();
      }
    } finally {
      const dump = scheduler.stallSnapshot();
      expect(dump.decodeQueuePeak).toBeLessThan(AFE_DECODE_QUEUE_HIGH_WATER_CAP + 8);
      expect(dump.decodeQueuePeak).toBeLessThan(125);
      expect(dump.unresolvedRequestedVideoFrames).toBe(0);
      expect(
        requestedEncodedInvariantHolds({
          unresolvedRequestedVideoFrames: 0,
          videoFramesRequested: 20,
          videoFramesEncoded: 20,
        }),
      ).toBe(true);
      expect(formatStallMessage(dump)).toContain("decodeQueueHighWater");
      scheduler.close();
    }
    expect(out).toHaveLength(20);
    for (let i = 1; i < out.length; i++) expect(out[i]!).toBeGreaterThan(out[i - 1]!);
  }, 20_000);
});
