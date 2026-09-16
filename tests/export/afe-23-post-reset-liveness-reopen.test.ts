import { existsSync, readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import {
  AFE_DECODE_STALL_MS,
  AfeVideoDecoder,
  currentTargetRequiredSample,
  decodeQueueHighWater,
  formatStallMessage,
  hardDependencyCeiling,
  identicalPostResetFingerprint,
  mayHardHorizonReset,
  mayPostResetLivenessReopen,
  maySubmittedUnseenHorizonReset,
  mustColdOpenVideoDecoder,
  nowMs,
  parseIsoBmff,
  postHorizonRequiredSample,
} from "../../src/core/frame-engine";
import {
  ControllableQueueDecoder,
  installControllableQueueDecoder,
} from "./afe-videodecoder-mock";

const LONG = "tests/fixtures/afe/afe-cfr-30-g60-8s.mp4";

/** Human EXE @ b91ecfc — AFE-22 reset fired, same 458333 death. */
const HUMAN = {
  sample: 28,
  ptsUs: 1_375_000,
  lastDecodedTs: 458_333,
  lastSubmitted: 34,
  decodeQueue: 19,
  decodeQueuePeak: 22,
  maxReorder: 2,
  prefetch: 4,
  lastRequired: 144,
  sampleCount: 240,
  postRecreateSubmitted: 35,
  postRecreateOutputs: 10,
};

function loadMovie(path: string) {
  if (!existsSync(path)) return null;
  return parseIsoBmff(new Uint8Array(readFileSync(path)));
}

const SOFT = decodeQueueHighWater(HUMAN.maxReorder, HUMAN.prefetch, { afterRecreate: true });
const FIRST_FILL = decodeQueueHighWater(HUMAN.maxReorder, HUMAN.prefetch, { afterRecreate: false });
const FORMULA = currentTargetRequiredSample({
  requested: HUMAN.sample,
  maxReorderSamples: HUMAN.maxReorder,
  prefetch: HUMAN.prefetch,
  sampleCount: HUMAN.sampleCount,
  lastRequiredDecodeSample: HUMAN.lastRequired,
});
const LIVE = postHorizonRequiredSample({
  requested: HUMAN.sample,
  currentTargetRequiredSample: FORMULA,
  lastSubmittedSample: HUMAN.lastSubmitted,
  lastRequiredDecodeSample: HUMAN.lastRequired,
  maxReorderSamples: HUMAN.maxReorder,
  prefetch: HUMAN.prefetch,
  sampleCount: HUMAN.sampleCount,
  exactReady: false,
  targetPtsSeen: false,
  lastDecodedTimestamp: HUMAN.lastDecodedTs,
  targetPtsUs: HUMAN.ptsUs,
});
const HARD = hardDependencyCeiling({
  softHighWater: SOFT,
  lastSubmittedSample: HUMAN.lastSubmitted,
  currentTargetRequiredSample: LIVE,
  maxReorderSamples: HUMAN.maxReorder,
  prefetch: HUMAN.prefetch,
});

const AFE21 = {
  sample: 38,
  lastSubmitted: 36,
  decodeQueue: 21,
  hard: 20,
  target: 44,
};

const SHAPE_A = {
  sample: 90,
  lastSubmitted: 82,
  decodeQueue: 15,
  hard: 22,
  target: 96,
};

async function seedAfterRecreate(decoder: AfeVideoDecoder, movie: NonNullable<ReturnType<typeof loadMovie>>) {
  decoder.setPrefetchHint(HUMAN.prefetch);
  decoder.beginStream(new Uint8Array(movie.sampleCount).fill(1), 0, {
    lastRequested: 130,
    lastRequiredDecodeSample: HUMAN.lastRequired,
    requestedIndexes: [HUMAN.sample],
  });
  const targetPts = decoder.chunkTimestampUs(movie.samples[HUMAN.sample]!);
  decoder.openRequested(HUMAN.sample, targetPts);
  decoder.setGopKeyframeStart(0);
  await decoder.recreate();
  decoder.setGopKeyframeStart(0);
  decoder.beginStream(new Uint8Array(movie.sampleCount).fill(1), 0, {
    lastRequested: 130,
    lastRequiredDecodeSample: HUMAN.lastRequired,
    requestedIndexes: [HUMAN.sample],
    keepResolved: true,
  });
  decoder.restoreOpenedIdentity(HUMAN.sample, targetPts);
  decoder.clearRecoveryRebuilding([HUMAN.sample]);
  return targetPts;
}

describe("AFE-23 A–H post-reset identical fingerprint gets cold liveness reopen", () => {
  let restore: (() => void) | undefined;
  afterEach(() => {
    restore?.();
    restore = undefined;
  });

  it("A. human shape: AFE-22 reset fired, same 458333 / 10 fingerprint, queue 19", () => {
    expect(SOFT).toBe(12);
    expect(FORMULA).toBe(34);
    expect(LIVE).toBe(44);
    expect(HARD).toBe(22);
    expect(HUMAN.lastSubmitted).toBeGreaterThanOrEqual(HUMAN.sample);
    expect(HUMAN.lastDecodedTs).toBeLessThan(HUMAN.ptsUs);
    expect(
      identicalPostResetFingerprint({
        beforeLastDecodedTs: HUMAN.lastDecodedTs,
        afterLastDecodedTs: HUMAN.lastDecodedTs,
        beforeOutputs: HUMAN.postRecreateOutputs,
        afterOutputs: HUMAN.postRecreateOutputs,
      }),
    ).toBe(true);
    expect(
      identicalPostResetFingerprint({
        beforeLastDecodedTs: HUMAN.lastDecodedTs,
        afterLastDecodedTs: 2_000_000,
        beforeOutputs: 10,
        afterOutputs: 10,
      }),
    ).toBe(false);
  });

  it("B. REGRESSION: after used reset + identical fingerprint, reopen — not another gopStart=0 reset", () => {
    expect(
      mayHardHorizonReset({
        exactReady: false,
        lastSubmittedSample: HUMAN.lastSubmitted,
        requestedSample: HUMAN.sample,
        currentTargetRequiredSample: LIVE,
        decodeQueueSize: HUMAN.decodeQueue,
        hardDependencyCeiling: HARD,
        outputProgressed: false,
        earlierKeyframeAvailable: false,
        recreateCount: 2,
        hardHorizonResetUsed: true,
        targetPtsSeen: false,
        softHighWater: SOFT,
        frozenAtHighWater: true,
        lastDecodedTimestamp: HUMAN.lastDecodedTs,
        targetPtsUs: HUMAN.ptsUs,
      }),
    ).toBe(false);
    expect(
      mayPostResetLivenessReopen({
        exactReady: false,
        targetPtsSeen: false,
        hardHorizonResetUsed: true,
        livenessReopenUsed: false,
        earlierKeyframeAvailable: false,
        identicalFingerprint: true,
        decodeQueueSize: HUMAN.decodeQueue,
        softHighWater: SOFT,
        frozenAtHighWater: true,
        lastDecodedTimestamp: HUMAN.lastDecodedTs,
        targetPtsUs: HUMAN.ptsUs,
      }),
    ).toBe(true);
    expect(
      mayPostResetLivenessReopen({
        exactReady: false,
        targetPtsSeen: false,
        hardHorizonResetUsed: true,
        livenessReopenUsed: true,
        earlierKeyframeAvailable: false,
        identicalFingerprint: true,
        decodeQueueSize: HUMAN.decodeQueue,
        softHighWater: SOFT,
        frozenAtHighWater: true,
        lastDecodedTimestamp: HUMAN.lastDecodedTs,
        targetPtsUs: HUMAN.ptsUs,
      }),
    ).toBe(false);
  });

  it("C. AFE-22 before reset, AFE-21, Shape A, first-fill stay unchanged", () => {
    expect(
      maySubmittedUnseenHorizonReset({
        exactReady: false,
        lastSubmittedSample: HUMAN.lastSubmitted,
        requestedSample: HUMAN.sample,
        targetPtsSeen: false,
        recreateCount: 1,
        hardHorizonResetUsed: false,
        earlierKeyframeAvailable: false,
        outputProgressed: false,
        decodeQueueSize: HUMAN.decodeQueue,
        softHighWater: SOFT,
        frozenAtHighWater: true,
        lastDecodedTimestamp: HUMAN.lastDecodedTs,
        targetPtsUs: HUMAN.ptsUs,
      }),
    ).toBe(true);
    expect(
      mayHardHorizonReset({
        exactReady: false,
        lastSubmittedSample: AFE21.lastSubmitted,
        requestedSample: AFE21.sample,
        currentTargetRequiredSample: AFE21.target,
        decodeQueueSize: AFE21.decodeQueue,
        hardDependencyCeiling: AFE21.hard,
        outputProgressed: false,
        earlierKeyframeAvailable: false,
        recreateCount: 1,
        hardHorizonResetUsed: false,
      }),
    ).toBe(true);
    expect(
      mayHardHorizonReset({
        exactReady: false,
        lastSubmittedSample: SHAPE_A.lastSubmitted,
        requestedSample: SHAPE_A.sample,
        currentTargetRequiredSample: SHAPE_A.target,
        decodeQueueSize: SHAPE_A.decodeQueue,
        hardDependencyCeiling: SHAPE_A.hard,
        outputProgressed: false,
        earlierKeyframeAvailable: false,
        recreateCount: 1,
        hardHorizonResetUsed: false,
        targetPtsSeen: false,
        softHighWater: SOFT,
      }),
    ).toBe(false);
    expect(
      mayPostResetLivenessReopen({
        exactReady: false,
        targetPtsSeen: false,
        hardHorizonResetUsed: false,
        livenessReopenUsed: false,
        earlierKeyframeAvailable: false,
        identicalFingerprint: true,
        decodeQueueSize: HUMAN.decodeQueue,
        softHighWater: SOFT,
        frozenAtHighWater: true,
        lastDecodedTimestamp: HUMAN.lastDecodedTs,
        targetPtsUs: HUMAN.ptsUs,
      }),
    ).toBe(false);
  });

  it("D. VIDEO-only does not evict; VIS→VIDEO / black→VIDEO must cold-open", () => {
    expect(
      mustColdOpenVideoDecoder({ previousPictureKind: null, nextPictureKind: "video" }),
    ).toBe(false);
    expect(
      mustColdOpenVideoDecoder({ previousPictureKind: "video", nextPictureKind: "video" }),
    ).toBe(false);
    expect(
      mustColdOpenVideoDecoder({ previousPictureKind: "vis", nextPictureKind: "video" }),
    ).toBe(true);
    expect(
      mustColdOpenVideoDecoder({ previousPictureKind: "black", nextPictureKind: "video" }),
    ).toBe(true);
    expect(
      mustColdOpenVideoDecoder({ previousPictureKind: "vis", nextPictureKind: "vis" }),
    ).toBe(false);
  });

  it("E. after AFE-22 reset with identical 458333/10, reopen is offered — reset is not", async () => {
    const movie = loadMovie(LONG);
    expect(movie).not.toBeNull();
    restore = installControllableQueueDecoder();
    const decoder = new AfeVideoDecoder({ ...movie!, maxReorderSamples: HUMAN.maxReorder });
    await decoder.ensure();
    const targetPts = await seedAfterRecreate(decoder, movie!);
    decoder.deliverOutputForTest(HUMAN.lastDecodedTs);
    for (let i = 0; i <= HUMAN.lastSubmitted; i++) decoder.submitEncoded(movie!.samples[i]!);
    const mock = ControllableQueueDecoder.last!;
    mock.decodeQueueSize = HUMAN.decodeQueue;
    decoder.capturePostResetFingerprint();
    decoder.noteHardHorizonReset();
    await decoder.recreate();
    decoder.setGopKeyframeStart(0);
    decoder.beginStream(new Uint8Array(movie!.sampleCount).fill(1), 0, {
      lastRequested: 130,
      lastRequiredDecodeSample: HUMAN.lastRequired,
      requestedIndexes: [HUMAN.sample],
      keepResolved: true,
    });
    decoder.restoreOpenedIdentity(HUMAN.sample, targetPts);
    decoder.clearRecoveryRebuilding([HUMAN.sample]);
    decoder.deliverOutputForTest(HUMAN.lastDecodedTs);
    for (let i = 0; i <= HUMAN.lastSubmitted; i++) decoder.submitEncoded(movie!.samples[i]!);
    const live = ControllableQueueDecoder.last!;
    live.decodeQueueSize = HUMAN.decodeQueue;
    expect(decoder.hasTargetPtsBeenSeen(targetPts)).toBe(false);
    expect(decoder.postResetFingerprintMatches()).toBe(true);
    expect(decoder.mayHardHorizonResetFor(HUMAN.sample)).toBe(false);
    expect(decoder.mayPostResetLivenessReopenFor(HUMAN.sample)).toBe(true);
    decoder.close();
  }, 10_000);

  it("F. cold reopen: SOFT window while stuck at 458333; no flood to 144; one use", async () => {
    const movie = loadMovie(LONG);
    expect(movie).not.toBeNull();
    restore = installControllableQueueDecoder();
    const decoder = new AfeVideoDecoder({ ...movie!, maxReorderSamples: HUMAN.maxReorder });
    await decoder.ensure();
    await seedAfterRecreate(decoder, movie!);
    decoder.deliverOutputForTest(HUMAN.lastDecodedTs);
    for (let i = 0; i <= HUMAN.lastSubmitted; i++) decoder.submitEncoded(movie!.samples[i]!);
    decoder.capturePostResetFingerprint();
    decoder.noteHardHorizonReset();
    await decoder.coldReopenNativeDecoder();
    decoder.setGopKeyframeStart(0);
    decoder.beginStream(new Uint8Array(movie!.sampleCount).fill(1), 0, {
      lastRequested: 130,
      lastRequiredDecodeSample: HUMAN.lastRequired,
      requestedIndexes: [HUMAN.sample],
      keepResolved: true,
    });
    const pts = decoder.chunkTimestampUs(movie!.samples[HUMAN.sample]!);
    decoder.restoreOpenedIdentity(HUMAN.sample, pts);
    decoder.clearRecoveryRebuilding([HUMAN.sample]);
    const live = ControllableQueueDecoder.last!;
    for (let i = 0; i < SOFT; i++) decoder.submitEncoded(movie!.samples[i]!);
    live.decodeQueueSize = SOFT;
    expect(decoder.livenessReopenConsumed).toBe(true);
    expect(decoder.decodeQueueHighWater).toBe(SOFT);
    expect(decoder.decodeQueueHighWater).toBeLessThan(FIRST_FILL);
    expect(decoder.outputGateBlocksHardSpend()).toBe(true);
    const borrow = await decoder.waitForDecodeCapacity(undefined, {
      requested: HUMAN.sample,
      budgetEnd: nowMs() + 40,
    });
    expect(borrow).toBe(false);
    expect(decoder.snapshot().lastSubmittedSample).toBeLessThan(HUMAN.lastRequired);
    expect(decoder.livenessReopenExhausted(HUMAN.sample)).toBe(true);
    expect(decoder.snapshot().decoderFlushCount).toBe(0);
    decoder.close();
  }, 10_000);

  it("G. dump names reset-fired + fingerprint + livenessReopen; no timeout / snap / flood", () => {
    expect(SOFT).toBe(12);
    expect(HARD).toBe(22);
    expect(AFE_DECODE_STALL_MS).toBe(3000);
    const text = formatStallMessage({
      sourceSampleRequested: HUMAN.sample,
      requestedSample: HUMAN.sample,
      requestedPtsUs: HUMAN.ptsUs,
      lastSubmittedSample: HUMAN.lastSubmitted,
      currentTargetRequiredSample: LIVE,
      formulaTargetRequiredSample: FORMULA,
      lastRequiredDecodeSample: HUMAN.lastRequired,
      lastDecodedTimestamp: HUMAN.lastDecodedTs,
      targetPtsUs: HUMAN.ptsUs,
      targetPtsSeen: false,
      decodeQueueSize: HUMAN.decodeQueue,
      decodeQueuePeak: HUMAN.decodeQueuePeak,
      decodeQueueHighWater: SOFT,
      softHighWater: SOFT,
      hardDependencyCeiling: HARD,
      gopKeyframeStart: 0,
      earlierKeyframeAvailable: false,
      hardHorizonResetUsed: true,
      postResetFingerprintTs: HUMAN.lastDecodedTs,
      postResetFingerprintOutputs: HUMAN.postRecreateOutputs,
      postResetFingerprintMatch: true,
      livenessReopenUsed: false,
      coldOpenAfterVis: true,
      postRecreateSubmitted: HUMAN.postRecreateSubmitted,
      postRecreateOutputs: HUMAN.postRecreateOutputs,
      postRecreateLastDecodedTs: HUMAN.lastDecodedTs,
      pumpSliceStart: 35,
      pumpSliceEnd: 34,
      frozenAtHighWater: true,
      stallPhase: "FINAL_FLUSH",
      stalledMs: 3000,
      decoderRecreateCount: 2,
      decoderResetCount: 2,
      visFrames: 0,
    });
    const head = text.slice(0, 800);
    expect(head).toContain("requested sample 28 PTS 1375000");
    expect(head).toContain("lastSubmittedSample 34");
    expect(head).toContain("requestedSubmitted yes");
    expect(head).toContain("horizonExtended yes");
    expect(head).toContain("hardHorizonReset yes");
    expect(head).toContain("postResetFingerprintMatch yes");
    expect(head).toContain("livenessReopen no");
    expect(head).toContain("coldOpenAfterVis yes");
    expect(text).not.toMatch(/nearest|snap|allowSkip|Mediabunny|HTMLVideo/i);
  });
});
