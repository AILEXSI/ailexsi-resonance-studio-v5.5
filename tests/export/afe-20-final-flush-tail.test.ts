import { existsSync, readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import {
  AFE_DECODE_QUEUE_RECOVERY_FILL,
  AFE_DECODE_STALL_MS,
  AFE_WAIT_EXACT_PTS_MS,
  AfeVideoDecoder,
  decodeQueueHighWater,
  exactRequestIdentityHolds,
  formatStallMessage,
  lastRequiredDecodeSample,
  mayGenuineFinalDrain,
  parseIsoBmff,
  usefulInputExhausted,
} from "../../src/core/frame-engine";
import {
  FlushLeavesQueueDecoder,
  installFlushLeavesQueueDecoder,
} from "./afe-videodecoder-mock";

const LONG = "tests/fixtures/afe/afe-cfr-30-g60-8s.mp4";
const BFRAME = "tests/fixtures/afe/afe-bframe-30-g30-2s.mp4";

/** Latest Windows EXE — first-fill FINAL_FLUSH tail, exact PTS never emitted. */
const HUMAN = {
  sample: 134,
  ptsUs: 5_625_000,
  lastDecodedTs: 5_583_333,
  neighborTs: 5_333_333,
  decodeQueue: 2,
  submitted: 140,
  lastRequired: 140,
  unresolved: 1,
  flushes: 1,
  sampleCount: 141,
};

function loadMovie(path: string) {
  if (!existsSync(path)) return null;
  return parseIsoBmff(new Uint8Array(readFileSync(path)));
}

describe("AFE-20 FINAL_FLUSH tail — requested submitted, exact PTS missing", () => {
  let restore: (() => void) | undefined;
  afterEach(() => {
    restore?.();
    restore = undefined;
  });

  it("A. human gates: submitted, lastRequired, useful exhausted, CASE B drain legal", () => {
    expect(
      usefulInputExhausted({
        lastSubmittedSample: HUMAN.submitted,
        lastRequiredDecodeSample: HUMAN.lastRequired,
        nextDecode: HUMAN.submitted + 1,
        sampleCount: HUMAN.sampleCount,
      }),
    ).toBe(true);
    expect(
      lastRequiredDecodeSample({
        lastRequested: HUMAN.sample,
        maxReorderSamples: 10,
        prefetch: 4,
        sampleCount: HUMAN.sampleCount,
      }),
    ).toBe(HUMAN.lastRequired);
    expect(
      mayGenuineFinalDrain({
        unresolvedRequestedVideoFrames: 1,
        usefulInputExhausted: true,
        finalFlushAttempted: true,
        targetPtsSeen: false,
        decodeQueueSize: HUMAN.decodeQueue,
        lastDecodedTimestamp: HUMAN.lastDecodedTs,
        targetPtsUs: HUMAN.ptsUs,
        recoveryRebuilding: false,
        transactionComplete: false,
      }),
    ).toBe(true);
    expect(
      mayGenuineFinalDrain({
        unresolvedRequestedVideoFrames: 1,
        usefulInputExhausted: true,
        finalFlushAttempted: true,
        targetPtsSeen: true,
        decodeQueueSize: HUMAN.decodeQueue,
      }),
    ).toBe(false);
    expect(decodeQueueHighWater(10, 4, { afterRecreate: false })).toBe(AFE_DECODE_QUEUE_RECOVERY_FILL);
    expect(AFE_DECODE_STALL_MS).toBe(3000);
    expect(AFE_WAIT_EXACT_PTS_MS).toBe(120);
  });

  it("B. waiter-null + ptsCurrentlyRegistered no is not identity", () => {
    expect(
      exactRequestIdentityHolds({
        unresolvedRequestedVideoFrames: 1,
        streamWaiterIndex: null,
        pendingPts: [],
        requestedPtsUs: HUMAN.ptsUs,
        ptsCurrentlyRegistered: false,
        streamReadyExact: false,
        recoveryRebuilding: false,
      }),
    ).toBe(false);
  });

  it("C. REGRESSION: first flush leaves queue 2, exact skipped → extra flush delivers exact PTS", async () => {
    const movie = loadMovie(BFRAME) ?? loadMovie(LONG);
    if (!movie) return;
    const index = 3;
    const pts = new AfeVideoDecoder(movie).chunkTimestampUs(movie.samples[index]!);
    restore = installFlushLeavesQueueDecoder({
      leaveOnFirstFlush: 2,
      skipPts: [pts],
      emitSkippedOnSecondFlush: true,
    });
    const decoder = new AfeVideoDecoder(movie);
    await decoder.ensure();
    decoder.beginStream(new Uint8Array(movie.sampleCount).fill(1), 0, {
      lastRequested: index,
      lastRequiredDecodeSample: index + 4,
      requestedIndexes: [index],
    });
    decoder.openRequested(index, pts);
    decoder.bindOrigin({
      sourceSampleRequested: index,
      requestedPtsUs: pts,
      videoFramesRequested: 1,
      videoFramesDecoded: 0,
      videoFramesEncoded: 0,
    });
    for (let i = 0; i <= index + 4; i++) decoder.submitEncoded(movie.samples[i]!);
    decoder.armFinalFlush([index]);
    const t0 = Date.now();
    await decoder.flushTail();
    expect(Date.now() - t0).toBeLessThan(AFE_DECODE_STALL_MS);
    expect(FlushLeavesQueueDecoder.last?.flushCount ?? 0).toBeGreaterThanOrEqual(2);
    const frame = decoder.takeReady(index);
    expect(frame).not.toBeNull();
    expect(frame!.timestamp).toBe(pts);
    expect(decoder.hasTargetPtsBeenSeen(pts)).toBe(true);
    expect(decoder.snapshot().decoderRecreateCount).toBe(0);
    expect(decoder.unresolvedRequestedCount()).toBe(0);
    decoder.assertOpenedOwnership({ sourceSampleRequested: index, requestedPtsUs: pts });
    frame!.close();
    decoder.close();
  }, 10_000);

  it("D. REGRESSION: hung first flush + queue 2 + exact unseen → extra flush, not 3s waiter-null sit", async () => {
    const movie = loadMovie(BFRAME) ?? loadMovie(LONG);
    if (!movie) return;
    const index = 3;
    const pts = new AfeVideoDecoder(movie).chunkTimestampUs(movie.samples[index]!);
    restore = installFlushLeavesQueueDecoder({
      leaveOnFirstFlush: 2,
      skipPts: [pts],
      emitSkippedOnSecondFlush: true,
      hangFirstFlush: true,
    });
    const decoder = new AfeVideoDecoder(movie);
    await decoder.ensure();
    decoder.beginStream(new Uint8Array(movie.sampleCount).fill(1), 0, {
      lastRequested: index,
      lastRequiredDecodeSample: index + 4,
      requestedIndexes: [index],
    });
    decoder.openRequested(index, pts);
    decoder.bindOrigin({ sourceSampleRequested: index, requestedPtsUs: pts });
    for (let i = 0; i <= index + 4; i++) decoder.submitEncoded(movie.samples[i]!);
    decoder.armFinalFlush([index]);
    const t0 = Date.now();
    await decoder.flushTail();
    const elapsed = Date.now() - t0;
    expect(elapsed).toBeLessThan(AFE_DECODE_STALL_MS);
    expect(FlushLeavesQueueDecoder.last?.flushCount ?? 0).toBeGreaterThanOrEqual(2);
    const frame = decoder.takeReady(index);
    expect(frame).not.toBeNull();
    expect(frame!.timestamp).toBe(pts);
    expect(decoder.ptsCurrentlyRegisteredFor(index) || decoder.isStreamReady(index) || frame != null).toBe(true);
    frame!.close();
    decoder.close();
  }, 10_000);

  it("E. neighbor outputs do not count as exact targetPts (5333333 ≠ 5625000)", async () => {
    const movie = loadMovie(BFRAME) ?? loadMovie(LONG);
    if (!movie) return;
    restore = installFlushLeavesQueueDecoder({ leaveOnFirstFlush: 2 });
    const decoder = new AfeVideoDecoder(movie);
    await decoder.ensure();
    const index = 3;
    const pts = decoder.chunkTimestampUs(movie.samples[index]!);
    decoder.beginStream(new Uint8Array(movie.sampleCount).fill(1), 0, {
      lastRequested: index,
      lastRequiredDecodeSample: index + 4,
      requestedIndexes: [index],
    });
    decoder.openRequested(index, pts);
    decoder.bindOrigin({ sourceSampleRequested: index, requestedPtsUs: pts });
    decoder.deliverOutputForTest(HUMAN.neighborTs);
    expect(decoder.hasTargetPtsBeenSeen(pts)).toBe(false);
    const snap = decoder.snapshot({ sourceSampleRequested: index, requestedPtsUs: pts, targetPtsUs: pts });
    expect(snap.targetPtsUs).toBe(pts);
    expect(snap.targetPtsSeen).toBe(false);
    expect(snap.targetPtsLastSeenTs).not.toBe(HUMAN.neighborTs);
    decoder.close();
  }, 10_000);

  it("F. after CASE B drain, identity is live or request is resolved — not waiter-null + unregistered", async () => {
    const movie = loadMovie(BFRAME) ?? loadMovie(LONG);
    if (!movie) return;
    const index = 3;
    const pts = new AfeVideoDecoder(movie).chunkTimestampUs(movie.samples[index]!);
    restore = installFlushLeavesQueueDecoder({
      leaveOnFirstFlush: 2,
      skipPts: [pts],
      emitSkippedOnSecondFlush: false,
    });
    const decoder = new AfeVideoDecoder(movie);
    await decoder.ensure();
    decoder.beginStream(new Uint8Array(movie.sampleCount).fill(1), 0, {
      lastRequested: index,
      lastRequiredDecodeSample: index + 4,
      requestedIndexes: [index],
    });
    decoder.openRequested(index, pts);
    decoder.bindOrigin({ sourceSampleRequested: index, requestedPtsUs: pts });
    for (let i = 0; i <= index + 4; i++) decoder.submitEncoded(movie.samples[i]!);
    decoder.armFinalFlush([index]);
    await decoder.flushTail();
    expect(decoder.takeReady(index)).toBeNull();
    expect(decoder.hasTargetPtsBeenSeen(pts)).toBe(false);
    expect(decoder.unresolvedRequestedCount()).toBe(1);
    decoder.retainExactIdentity(index, pts);
    expect(decoder.ptsCurrentlyRegisteredFor(index)).toBe(true);
    decoder.assertOpenedOwnership({ sourceSampleRequested: index, requestedPtsUs: pts });
    decoder.close();
  }, 10_000);

  it("G. dump still names exact 5625000; no snap / nearest / timeout bump", () => {
    const text = formatStallMessage({
      sourceSampleRequested: HUMAN.sample,
      requestedPtsUs: HUMAN.ptsUs,
      lastSubmittedSample: HUMAN.submitted,
      lastRequiredDecodeSample: HUMAN.lastRequired,
      decodeQueueSize: HUMAN.decodeQueue,
      lastDecodedTimestamp: HUMAN.lastDecodedTs,
      targetPtsUs: HUMAN.ptsUs,
      targetPtsSeen: false,
      targetPtsLastSeenTs: HUMAN.neighborTs,
      targetPtsOutputCount: 12,
      usefulInputExhausted: true,
      finalFlushArmed: true,
      stallPhase: "FINAL_FLUSH",
      unresolvedRequestedVideoFrames: 1,
      ptsEverRegistered: true,
      ptsCurrentlyRegistered: false,
      streamWaiterIndex: null,
      stalledMs: 3000,
    });
    expect(text).toContain("requested sample 134 PTS 5625000");
    expect(text).toContain("targetPts 5625000");
    expect(text).toContain("targetPtsSeen no");
    expect(text).toContain("lastDecodedTs 5583333");
    expect(text).not.toMatch(/nearest|snap|dup|paintFallback|allowSkip|Mediabunny|HTMLVideo|ffmpeg|WASM/i);
  });
});
