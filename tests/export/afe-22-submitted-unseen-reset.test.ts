import { existsSync, readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import {
  AFE_DECODE_STALL_MS,
  AfeVideoDecoder,
  currentTargetRequiredSample,
  decodeQueueHighWater,
  formatStallMessage,
  hardDependencyCeiling,
  lastRequiredDecodeSample,
  mayHardHorizonReset,
  maySubmittedUnseenHorizonReset,
  nowMs,
  parseIsoBmff,
  postHorizonRequiredSample,
} from "../../src/core/frame-engine";
import {
  ControllableQueueDecoder,
  installControllableQueueDecoder,
} from "./afe-videodecoder-mock";

const LONG = "tests/fixtures/afe/afe-cfr-30-g60-8s.mp4";

/** Human EXE @ c73447a — sample 28 submitted, exact PTS never seen. */
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

describe("AFE-22 A–G submitted-but-unseen exact PTS gets HARD-horizon reset", () => {
  let restore: (() => void) | undefined;
  afterEach(() => {
    restore?.();
    restore = undefined;
  });

  it("A. human shape: 34 >= requested 28, formula 34, live 44, queue 19 >= SOFT 12, PTS unseen", () => {
    expect(SOFT).toBe(12);
    expect(FORMULA).toBe(34);
    expect(LIVE).toBe(44);
    expect(HARD).toBe(22);
    expect(HUMAN.lastSubmitted).toBeGreaterThanOrEqual(HUMAN.sample);
    expect(HUMAN.lastSubmitted).toBe(FORMULA);
    expect(LIVE).toBeGreaterThan(FORMULA);
    expect(HUMAN.decodeQueue).toBeGreaterThanOrEqual(SOFT);
    expect(HUMAN.decodeQueue).toBeLessThan(HARD);
    expect(HUMAN.lastDecodedTs).toBeLessThan(HUMAN.ptsUs);
    expect(
      lastRequiredDecodeSample({
        lastRequested: HUMAN.sample,
        maxReorderSamples: HUMAN.maxReorder,
        prefetch: HUMAN.prefetch,
        sampleCount: HUMAN.sampleCount,
      }),
    ).toBe(FORMULA);
  });

  it("B. formula 34 vs current 44 is AFE-18 post-horizon, not a dump bug", () => {
    expect(LIVE).toBe(FORMULA + 6 + 4);
    expect(LIVE).toBeLessThan(HUMAN.lastRequired);
    const text = formatStallMessage({
      requestedSample: HUMAN.sample,
      sourceSampleRequested: HUMAN.sample,
      lastSubmittedSample: HUMAN.lastSubmitted,
      formulaTargetRequiredSample: FORMULA,
      currentTargetRequiredSample: LIVE,
      lastRequiredDecodeSample: HUMAN.lastRequired,
    });
    expect(text).toContain("formulaTargetRequiredSample 34");
    expect(text).toContain("currentTargetRequiredSample 44");
    expect(text).toContain("horizonExtended yes");
    expect(text).toContain("requestedSubmitted yes");
  });

  it("C. REGRESSION: submitted + unseen PTS after recreate resets — lastSubmitted < requested is not required", () => {
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
        lastSubmittedSample: HUMAN.lastSubmitted,
        requestedSample: HUMAN.sample,
        currentTargetRequiredSample: LIVE,
        decodeQueueSize: HUMAN.decodeQueue,
        hardDependencyCeiling: HARD,
        outputProgressed: false,
        earlierKeyframeAvailable: false,
        recreateCount: 1,
        hardHorizonResetUsed: false,
        targetPtsSeen: false,
        softHighWater: SOFT,
        frozenAtHighWater: true,
        lastDecodedTimestamp: HUMAN.lastDecodedTs,
        targetPtsUs: HUMAN.ptsUs,
      }),
    ).toBe(true);
  });

  it("D. AFE-21 / Shape A / first-fill / seen PTS / used stay unchanged", () => {
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
      mayHardHorizonReset({
        exactReady: false,
        lastSubmittedSample: HUMAN.lastSubmitted,
        requestedSample: HUMAN.sample,
        currentTargetRequiredSample: LIVE,
        decodeQueueSize: HUMAN.decodeQueue,
        hardDependencyCeiling: HARD,
        outputProgressed: false,
        earlierKeyframeAvailable: false,
        recreateCount: 0,
        hardHorizonResetUsed: false,
        targetPtsSeen: false,
        softHighWater: SOFT,
        frozenAtHighWater: true,
        lastDecodedTimestamp: HUMAN.lastDecodedTs,
        targetPtsUs: HUMAN.ptsUs,
      }),
    ).toBe(false);
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
        recreateCount: 1,
        hardHorizonResetUsed: false,
        targetPtsSeen: true,
        softHighWater: SOFT,
        frozenAtHighWater: true,
        lastDecodedTimestamp: HUMAN.lastDecodedTs,
        targetPtsUs: HUMAN.ptsUs,
      }),
    ).toBe(false);
    expect(
      mayHardHorizonReset({
        exactReady: false,
        lastSubmittedSample: 92,
        requestedSample: 68,
        currentTargetRequiredSample: 80,
        decodeQueueSize: 22,
        hardDependencyCeiling: 22,
        outputProgressed: false,
        earlierKeyframeAvailable: false,
        recreateCount: 1,
        hardHorizonResetUsed: false,
      }),
    ).toBe(false);
  });

  it("E. after recreate, submitted 34 with unseen PTS offers reset — not empty 35-34", async () => {
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
    expect(decoder.snapshot({ sourceSampleRequested: HUMAN.sample }).lastSubmittedSample).toBe(HUMAN.lastSubmitted);
    expect(decoder.hasTargetPtsBeenSeen(targetPts)).toBe(false);
    expect(decoder.formulaTargetRequiredFor(HUMAN.sample)).toBe(FORMULA);
    expect(decoder.currentTargetRequiredFor(HUMAN.sample)).toBe(LIVE);
    expect(decoder.mayHardHorizonResetFor(HUMAN.sample)).toBe(true);
    expect(decoder.hardHorizonResetConsumed).toBe(false);
    decoder.close();
  }, 10_000);

  it("F. one output-gated reset; exhausted if still unseen — no flood to 144", async () => {
    const movie = loadMovie(LONG);
    expect(movie).not.toBeNull();
    restore = installControllableQueueDecoder();
    const decoder = new AfeVideoDecoder({ ...movie!, maxReorderSamples: HUMAN.maxReorder });
    await decoder.ensure();
    await seedAfterRecreate(decoder, movie!);
    decoder.deliverOutputForTest(HUMAN.lastDecodedTs);
    for (let i = 0; i <= HUMAN.lastSubmitted; i++) decoder.submitEncoded(movie!.samples[i]!);
    const mock = ControllableQueueDecoder.last!;
    mock.decodeQueueSize = HUMAN.decodeQueue;
    decoder.noteHardHorizonReset();
    await decoder.recreate();
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
    const borrow = await decoder.waitForDecodeCapacity(undefined, {
      requested: HUMAN.sample,
      budgetEnd: nowMs() + 40,
    });
    expect(borrow).toBe(false);
    expect(decoder.outputGateBlocksHardSpend()).toBe(true);
    expect(decoder.snapshot().lastSubmittedSample).toBeLessThan(HUMAN.lastRequired);
    expect(decoder.hardHorizonResetExhausted(HUMAN.sample)).toBe(true);
    expect(decoder.snapshot().decoderFlushCount).toBe(0);
    decoder.close();
  }, 10_000);

  it("G. dump names submitted-unseen + horizonExtended; no timeout / SOFT raise / snap", () => {
    expect(SOFT).toBe(12);
    expect(HARD).toBe(22);
    expect(AFE_DECODE_STALL_MS).toBe(3000);
    expect(decodeQueueHighWater(HUMAN.maxReorder, HUMAN.prefetch, { afterRecreate: true })).toBe(12);
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
      hardHorizonResetUsed: false,
      postRecreateSubmitted: HUMAN.postRecreateSubmitted,
      postRecreateOutputs: HUMAN.postRecreateOutputs,
      postRecreateLastDecodedTs: HUMAN.lastDecodedTs,
      pumpSliceStart: 35,
      pumpSliceEnd: 34,
      frozenAtHighWater: true,
      stallPhase: "FINAL_FLUSH",
      stalledMs: 3000,
      decoderRecreateCount: 1,
      decoderFlushCount: 3,
    });
    const head = text.slice(0, 720);
    expect(head).toContain("requested sample 28 PTS 1375000");
    expect(head).toContain("lastSubmittedSample 34");
    expect(head).toContain("requestedSubmitted yes");
    expect(head).toContain("formulaTargetRequiredSample 34");
    expect(head).toContain("currentTargetRequiredSample 44");
    expect(head).toContain("horizonExtended yes");
    expect(head).toContain("hardHorizonReset no");
    expect(text).toContain("hardHorizonReset no");
    expect(text).not.toMatch(/nearest|snap|allowSkip|Mediabunny|HTMLVideo/i);
  });
});
