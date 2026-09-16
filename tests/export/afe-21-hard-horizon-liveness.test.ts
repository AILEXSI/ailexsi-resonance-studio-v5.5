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
  mayAdvancePastSoftFreeze,
  mayBorrowHardDependencyCredits,
  mayEarlierKeyframeRecover,
  mayHardHorizonReset,
  mayResumeDecode,
  maySubmitEncoded,
  nowMs,
  parseIsoBmff,
  queueRespectsHardCeiling,
} from "../../src/core/frame-engine";
import {
  ControllableQueueDecoder,
  installControllableQueueDecoder,
} from "./afe-videodecoder-mock";

const LONG = "tests/fixtures/afe/afe-cfr-30-g60-8s.mp4";

/** Human EXE on AFE-20 tip — sample 38, queue already at/over HARD. */
const HUMAN = {
  sample: 38,
  ptsUs: 1_625_000,
  lastDecodedTs: 458_333,
  lastSubmitted: 36,
  decodeQueue: 21,
  decodeQueuePeak: 22,
  maxReorder: 2,
  prefetch: 4,
  lastRequired: 140,
  sampleCount: 240,
  postRecreateSubmitted: 37,
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
const HARD_AT_STALL = hardDependencyCeiling({
  softHighWater: SOFT,
  lastSubmittedSample: HUMAN.lastSubmitted,
  currentTargetRequiredSample: FORMULA,
  maxReorderSamples: HUMAN.maxReorder,
  prefetch: HUMAN.prefetch,
});
const HARD_AT_START = hardDependencyCeiling({
  softHighWater: SOFT,
  lastSubmittedSample: -1,
  currentTargetRequiredSample: FORMULA,
  maxReorderSamples: HUMAN.maxReorder,
  prefetch: HUMAN.prefetch,
});

const SHAPE_A = {
  sample: 90,
  lastSubmitted: 82,
  decodeQueue: 15,
  maxReorder: 2,
  prefetch: 4,
  lastRequired: 140,
  sampleCount: 240,
};
const SHAPE_A_SOFT = decodeQueueHighWater(SHAPE_A.maxReorder, SHAPE_A.prefetch, { afterRecreate: true });
const SHAPE_A_FORMULA = currentTargetRequiredSample({
  requested: SHAPE_A.sample,
  maxReorderSamples: SHAPE_A.maxReorder,
  prefetch: SHAPE_A.prefetch,
  sampleCount: SHAPE_A.sampleCount,
  lastRequiredDecodeSample: SHAPE_A.lastRequired,
});
const SHAPE_A_HARD = hardDependencyCeiling({
  softHighWater: SHAPE_A_SOFT,
  lastSubmittedSample: SHAPE_A.lastSubmitted,
  currentTargetRequiredSample: SHAPE_A_FORMULA,
  maxReorderSamples: SHAPE_A.maxReorder,
  prefetch: SHAPE_A.prefetch,
});

async function seedAfterRecreate(decoder: AfeVideoDecoder, movie: NonNullable<ReturnType<typeof loadMovie>>) {
  decoder.setPrefetchHint(HUMAN.prefetch);
  decoder.beginStream(new Uint8Array(movie.sampleCount).fill(1), 0, {
    lastRequested: 120,
    lastRequiredDecodeSample: HUMAN.lastRequired,
    requestedIndexes: [HUMAN.sample],
  });
  const targetPts = decoder.chunkTimestampUs(movie.samples[HUMAN.sample]!);
  decoder.openRequested(HUMAN.sample, targetPts);
  decoder.setGopKeyframeStart(0);
  await decoder.recreate();
  decoder.setGopKeyframeStart(0);
  decoder.beginStream(new Uint8Array(movie.sampleCount).fill(1), 0, {
    lastRequested: 120,
    lastRequiredDecodeSample: HUMAN.lastRequired,
    requestedIndexes: [HUMAN.sample],
    keepResolved: true,
  });
  decoder.restoreOpenedIdentity(HUMAN.sample, targetPts);
  decoder.clearRecoveryRebuilding([HUMAN.sample]);
  return targetPts;
}

describe("AFE-21 A–H HARD ceiling reached before local horizon + post-recreate liveness", () => {
  let restore: (() => void) | undefined;
  afterEach(() => {
    restore?.();
    restore = undefined;
  });

  it("A. human shape: lastSubmitted 36 < requested 38 < target 44, SOFT 12, HARD 20, queue 21 peak 22", () => {
    expect(SOFT).toBe(12);
    expect(FORMULA).toBe(44);
    expect(HARD_AT_STALL).toBe(20);
    expect(HARD_AT_START).toBe(22);
    expect(HUMAN.lastSubmitted).toBeLessThan(HUMAN.sample);
    expect(HUMAN.sample).toBeLessThan(FORMULA);
    expect(HUMAN.decodeQueue).toBeGreaterThan(HARD_AT_STALL);
    expect(HUMAN.decodeQueuePeak).toBeGreaterThan(HARD_AT_STALL);
    expect(HUMAN.decodeQueuePeak).toBe(HARD_AT_START);
    expect(queueRespectsHardCeiling({ decodeQueueSize: HUMAN.decodeQueue, hardDependencyCeiling: HARD_AT_STALL })).toBe(
      false,
    );
    expect(
      lastRequiredDecodeSample({
        lastRequested: HUMAN.sample,
        maxReorderSamples: HUMAN.maxReorder,
        prefetch: HUMAN.prefetch,
        sampleCount: HUMAN.sampleCount,
      }),
    ).toBe(FORMULA);
    expect(HUMAN.lastRequired).toBe(140);
    expect(HUMAN.postRecreateSubmitted - HUMAN.postRecreateOutputs).toBe(27);
  });

  it("B. remaining-shrink HARD 22→20 under a live queue is the overrun — pin must keep 22", () => {
    expect(HARD_AT_START).toBe(22);
    expect(HARD_AT_STALL).toBe(20);
    expect(HARD_AT_STALL).toBeLessThan(HUMAN.decodeQueue);
    expect(HARD_AT_START).toBeGreaterThanOrEqual(HUMAN.decodeQueuePeak);
    expect(
      mayBorrowHardDependencyCredits({
        exactReady: false,
        usefulInputRemains: true,
        currentTargetRequiredSample: FORMULA,
        lastSubmittedSample: HUMAN.lastSubmitted,
        outputProgressed: false,
        decodeQueueSize: HUMAN.decodeQueue,
        softHighWater: SOFT,
        hardDependencyCeiling: HARD_AT_STALL,
      }),
    ).toBe(false);
    expect(
      mayAdvancePastSoftFreeze({
        frozenAtSoftHighWater: true,
        lastSubmittedSample: HUMAN.lastSubmitted,
        currentTargetRequiredSample: FORMULA,
        decodeQueueSize: HUMAN.decodeQueue,
        hardDependencyCeiling: HARD_AT_STALL,
        exactReady: false,
      }),
    ).toBe(false);
  });

  it("C. HARD is an absolute submit cap — queue >= HARD never submits", () => {
    expect(
      maySubmitEncoded({
        decodeQueueSize: HUMAN.decodeQueue,
        highWater: SOFT,
        outputProgressed: false,
        paused: true,
        exactReady: false,
        mustBorrowHardDependencyCredits: true,
        hardDependencyCeiling: HARD_AT_STALL,
      }),
    ).toBe(false);
    expect(
      maySubmitEncoded({
        decodeQueueSize: HARD_AT_START,
        highWater: SOFT,
        outputProgressed: false,
        mustBorrowHardDependencyCredits: true,
        hardDependencyCeiling: HARD_AT_START,
      }),
    ).toBe(false);
    expect(
      mayResumeDecode({
        decodeQueueSize: HUMAN.decodeQueue,
        highWater: SOFT,
        lowWater: 6,
        exactReady: false,
        paused: true,
        mustBorrowHardDependencyCredits: true,
        hardDependencyCeiling: HARD_AT_STALL,
      }),
    ).toBe(false);
    expect(
      maySubmitEncoded({
        decodeQueueSize: 15,
        highWater: SOFT,
        outputProgressed: true,
        paused: true,
        exactReady: false,
        mustBorrowHardDependencyCredits: true,
        hardDependencyCeiling: HARD_AT_START,
      }),
    ).toBe(true);
  });

  it("D. mayHardHorizonReset: human yes; Shape A / lastSubmitted>=requested / earlier I / used → no", () => {
    expect(
      mayHardHorizonReset({
        exactReady: false,
        lastSubmittedSample: HUMAN.lastSubmitted,
        requestedSample: HUMAN.sample,
        currentTargetRequiredSample: FORMULA,
        decodeQueueSize: HUMAN.decodeQueue,
        hardDependencyCeiling: HARD_AT_STALL,
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
        currentTargetRequiredSample: SHAPE_A_FORMULA,
        decodeQueueSize: SHAPE_A.decodeQueue,
        hardDependencyCeiling: SHAPE_A_HARD,
        outputProgressed: false,
        earlierKeyframeAvailable: false,
        recreateCount: 1,
        hardHorizonResetUsed: false,
      }),
    ).toBe(false);
    expect(SHAPE_A.decodeQueue).toBeLessThan(SHAPE_A_HARD);
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
    expect(
      mayHardHorizonReset({
        exactReady: false,
        lastSubmittedSample: HUMAN.lastSubmitted,
        requestedSample: HUMAN.sample,
        currentTargetRequiredSample: FORMULA,
        decodeQueueSize: HUMAN.decodeQueue,
        hardDependencyCeiling: HARD_AT_STALL,
        outputProgressed: false,
        earlierKeyframeAvailable: true,
        recreateCount: 1,
        hardHorizonResetUsed: false,
      }),
    ).toBe(false);
    expect(
      mayHardHorizonReset({
        exactReady: false,
        lastSubmittedSample: HUMAN.lastSubmitted,
        requestedSample: HUMAN.sample,
        currentTargetRequiredSample: FORMULA,
        decodeQueueSize: HUMAN.decodeQueue,
        hardDependencyCeiling: HARD_AT_STALL,
        outputProgressed: false,
        earlierKeyframeAvailable: false,
        recreateCount: 1,
        hardHorizonResetUsed: true,
      }),
    ).toBe(false);
    expect(
      mayEarlierKeyframeRecover({
        frozenHighWaterAfterRecreate: true,
        earlierKeyframeOrigin: null,
        earlierKeyframeRecovered: false,
        gopKeyframeStart: 0,
        earlierKeyframeAvailable: false,
      }),
    ).toBe(false);
  });

  it("E. after recreate, pin keeps HARD 22 while remaining shrinks; queue never exceeds pin", async () => {
    const movie = loadMovie(LONG);
    expect(movie).not.toBeNull();
    restore = installControllableQueueDecoder();
    const decoder = new AfeVideoDecoder({ ...movie!, maxReorderSamples: HUMAN.maxReorder });
    await decoder.ensure();
    await seedAfterRecreate(decoder, movie!);
    for (let i = 0; i <= 11; i++) decoder.submitEncoded(movie!.samples[i]!);
    const mock = ControllableQueueDecoder.last!;
    mock.decodeQueueSize = SOFT;
    const pinAllow = await decoder.waitForDecodeCapacity(undefined, {
      requested: HUMAN.sample,
      budgetEnd: nowMs() + 40,
    });
    expect(pinAllow).toBe(true);
    expect(decoder.effectiveHardCeilingFor(HUMAN.sample)).toBe(HARD_AT_START);
    decoder.deliverOutputForTest(HUMAN.lastDecodedTs);
    for (let i = 12; i <= HUMAN.lastSubmitted; i++) decoder.submitEncoded(movie!.samples[i]!);
    mock.decodeQueueSize = HUMAN.decodeQueue;
    expect(decoder.hardDependencyCeilingFor(HUMAN.sample)).toBe(HARD_AT_STALL);
    expect(decoder.effectiveHardCeilingFor(HUMAN.sample)).toBe(HARD_AT_START);
    expect(decoder.snapshot({ sourceSampleRequested: HUMAN.sample }).hardDependencyCeiling).toBe(HARD_AT_START);
    expect(decoder.snapshot({ sourceSampleRequested: HUMAN.sample }).lastSubmittedSample).toBe(HUMAN.lastSubmitted);
    expect(queueRespectsHardCeiling({
      decodeQueueSize: decoder.decodeQueueSize,
      hardDependencyCeiling: decoder.effectiveHardCeilingFor(HUMAN.sample),
    })).toBe(true);
    mock.decodeQueueSize = HARD_AT_START;
    const atCap = await decoder.waitForDecodeCapacity(undefined, {
      requested: HUMAN.sample,
      budgetEnd: nowMs() + 40,
    });
    expect(atCap).toBe(false);
    expect(decoder.mayHardHorizonResetFor(HUMAN.sample)).toBe(true);
    expect(decoder.snapshot().lastSubmittedSample).toBeLessThan(HUMAN.lastRequired);
    expect(decoder.snapshot().decoderFlushCount).toBe(0);
    decoder.close();
  }, 10_000);

  it("F. HARD-horizon reset is output-gated — no HARD spend without a new emit", async () => {
    const movie = loadMovie(LONG);
    expect(movie).not.toBeNull();
    restore = installControllableQueueDecoder();
    const decoder = new AfeVideoDecoder({ ...movie!, maxReorderSamples: HUMAN.maxReorder });
    await decoder.ensure();
    await seedAfterRecreate(decoder, movie!);
    for (let i = 0; i <= HUMAN.lastSubmitted; i++) decoder.submitEncoded(movie!.samples[i]!);
    const mock = ControllableQueueDecoder.last!;
    mock.decodeQueueSize = HUMAN.decodeQueue;
    decoder.noteHardHorizonReset();
    expect(decoder.hardHorizonResetConsumed).toBe(true);
    expect(decoder.outputGateBlocksHardSpend()).toBe(true);
    await decoder.recreate();
    decoder.setGopKeyframeStart(0);
    decoder.beginStream(new Uint8Array(movie!.sampleCount).fill(1), 0, {
      lastRequested: 120,
      lastRequiredDecodeSample: HUMAN.lastRequired,
      requestedIndexes: [HUMAN.sample],
      keepResolved: true,
    });
    const pts = decoder.chunkTimestampUs(movie!.samples[HUMAN.sample]!);
    decoder.restoreOpenedIdentity(HUMAN.sample, pts);
    decoder.clearRecoveryRebuilding([HUMAN.sample]);
    expect(decoder.hardHorizonResetConsumed).toBe(true);
    expect(decoder.outputGateBlocksHardSpend()).toBe(true);
    const liveF = ControllableQueueDecoder.last!;
    for (let i = 0; i < SOFT; i++) decoder.submitEncoded(movie!.samples[i]!);
    liveF.decodeQueueSize = SOFT;
    const borrow = await decoder.waitForDecodeCapacity(undefined, {
      requested: HUMAN.sample,
      budgetEnd: nowMs() + 40,
    });
    expect(borrow).toBe(false);
    expect(decoder.canBorrowTowardLocalHorizon(HUMAN.sample)).toBe(false);
    expect(decoder.snapshot().lastSubmittedSample).toBeLessThan(HUMAN.sample);
    expect(decoder.snapshot().lastSubmittedSample).toBeLessThan(SOFT + 2);
    expect(decoder.snapshot().decodeQueueSize).toBeLessThanOrEqual(SOFT);
    expect(decoder.hardHorizonResetExhausted(HUMAN.sample)).toBe(true);
    decoder.close();
  }, 10_000);

  it("G. after reset, proven output lifts the gate and lastSubmitted can reach requested 38 — never 140", async () => {
    const movie = loadMovie(LONG);
    expect(movie).not.toBeNull();
    restore = installControllableQueueDecoder();
    const decoder = new AfeVideoDecoder({ ...movie!, maxReorderSamples: HUMAN.maxReorder });
    await decoder.ensure();
    await seedAfterRecreate(decoder, movie!);
    for (let i = 0; i <= HUMAN.lastSubmitted; i++) decoder.submitEncoded(movie!.samples[i]!);
    const mock = ControllableQueueDecoder.last!;
    mock.decodeQueueSize = HARD_AT_START;
    decoder.deliverOutputForTest(HUMAN.lastDecodedTs);
    decoder.noteHardHorizonReset();
    await decoder.recreate();
    decoder.setGopKeyframeStart(0);
    decoder.beginStream(new Uint8Array(movie!.sampleCount).fill(1), 0, {
      lastRequested: 120,
      lastRequiredDecodeSample: HUMAN.lastRequired,
      requestedIndexes: [HUMAN.sample],
      keepResolved: true,
    });
    const pts = decoder.chunkTimestampUs(movie!.samples[HUMAN.sample]!);
    decoder.restoreOpenedIdentity(HUMAN.sample, pts);
    decoder.clearRecoveryRebuilding([HUMAN.sample]);
    const liveG = ControllableQueueDecoder.last!;
    for (let i = 0; i < SOFT; i++) decoder.submitEncoded(movie!.samples[i]!);
    liveG.decodeQueueSize = SOFT;
    decoder.deliverOutputForTest(416_667);
    expect(decoder.outputGateBlocksHardSpend()).toBe(false);
    expect(decoder.canBorrowTowardLocalHorizon(HUMAN.sample)).toBe(true);
    let next = SOFT;
    const hard = decoder.effectiveHardCeilingFor(HUMAN.sample);
    while (next <= HUMAN.sample) {
      const allow = await decoder.waitForDecodeCapacity(undefined, {
        requested: HUMAN.sample,
        budgetEnd: nowMs() + 40,
      });
      if (!allow) break;
      decoder.submitEncoded(movie!.samples[next]!);
      next += 1;
      liveG.decodeQueueSize = SOFT;
      expect(liveG.decodeQueueSize).toBeLessThanOrEqual(hard);
    }
    expect(decoder.snapshot().lastSubmittedSample).toBeGreaterThanOrEqual(HUMAN.sample);
    expect(decoder.snapshot().lastSubmittedSample).toBeLessThan(HUMAN.lastRequired);
    expect(decoder.snapshot().lastSubmittedSample).toBeLessThanOrEqual(FORMULA);
    expect(decoder.snapshot().decoderFlushCount).toBe(0);
    expect(decoder.snapshot().hardHorizonResetUsed).toBe(true);
    decoder.close();
  }, 10_000);

  it("H. dump ledger names HARD overrun + reset; no timeout / SOFT raise / snap / flood", () => {
    expect(SOFT).toBe(12);
    expect(HARD_AT_STALL).toBe(20);
    expect(HARD_AT_START).toBe(22);
    expect(SHAPE_A_SOFT).toBe(12);
    expect(SHAPE_A_HARD).toBe(22);
    expect(AFE_DECODE_STALL_MS).toBe(3000);
    expect(decodeQueueHighWater(HUMAN.maxReorder, HUMAN.prefetch, { afterRecreate: true })).toBe(12);
    expect(decodeQueueHighWater(HUMAN.maxReorder, HUMAN.prefetch, { afterRecreate: false })).toBe(40);
    const text = formatStallMessage({
      sourceSampleRequested: HUMAN.sample,
      requestedSample: HUMAN.sample,
      requestedPtsUs: HUMAN.ptsUs,
      lastSubmittedSample: HUMAN.lastSubmitted,
      currentTargetRequiredSample: FORMULA,
      formulaTargetRequiredSample: FORMULA,
      lastRequiredDecodeSample: HUMAN.lastRequired,
      lastDecodedTimestamp: HUMAN.lastDecodedTs,
      targetPtsUs: HUMAN.ptsUs,
      targetPtsSeen: false,
      decodeQueueSize: HUMAN.decodeQueue,
      decodeQueuePeak: HUMAN.decodeQueuePeak,
      decodeQueueHighWater: SOFT,
      softHighWater: SOFT,
      hardDependencyCeiling: HARD_AT_STALL,
      gopKeyframeStart: 0,
      earlierKeyframeAvailable: false,
      earlierKeyframeRecovered: false,
      hardHorizonResetUsed: false,
      postRecreateSubmitted: HUMAN.postRecreateSubmitted,
      postRecreateOutputs: HUMAN.postRecreateOutputs,
      postRecreateLastDecodedTs: HUMAN.lastDecodedTs,
      pumpSliceStart: 37,
      pumpSliceEnd: 36,
      frozenAtHighWater: true,
      backpressureBlocked: true,
      noMoreSubmission: true,
      stallPhase: "WAIT_EXACT_PTS",
      stalledMs: 3000,
      decoderRecreateCount: 1,
    });
    const head = text.slice(0, 520);
    expect(head).toContain("requested sample 38 PTS 1625000");
    expect(head).toContain("lastSubmittedSample 36");
    expect(head).toContain("requestedSubmitted no");
    expect(head).toContain("currentTargetRequiredSample 44");
    expect(head).toContain("softHighWater 12");
    expect(head).toContain("hardDependencyCeiling 20");
    expect(head).toContain("decodeQueue 21");
    expect(head).toContain("pumpSlice 37-36");
    expect(text).toContain("hardHorizonReset no");
    expect(text).toContain("decodeQueuePeak 22");
    expect(text).not.toMatch(/nearest|snap|allowSkip|Mediabunny|HTMLVideo/i);
  });
});
