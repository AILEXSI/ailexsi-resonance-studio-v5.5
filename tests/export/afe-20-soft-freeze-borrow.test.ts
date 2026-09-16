import { existsSync, readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import {
  AfeVideoDecoder,
  currentTargetRequiredSample,
  decodeQueueHighWater,
  formatStallMessage,
  hardDependencyCeiling,
  lastRequiredDecodeSample,
  mayAdvancePastSoftFreeze,
  mayEarlierKeyframeRecover,
  mayLocalHorizonFinalFlush,
  nowMs,
  parseIsoBmff,
} from "../../src/core/frame-engine";
import {
  ControllableQueueDecoder,
  installControllableQueueDecoder,
} from "./afe-videodecoder-mock";

const LONG = "tests/fixtures/afe/afe-cfr-30-g60-8s.mp4";

/** Human EXE stall — real clip, not user-video-B fixture. */
const HUMAN = {
  sample: 81,
  ptsUs: 3_416_667,
  lastDecodedTs: 2_500_000,
  lastSubmitted: 75,
  decodeQueue: 15,
  maxReorder: 5,
  prefetch: 4,
  lastRequired: 140,
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
  sampleCount: 240,
  lastRequiredDecodeSample: HUMAN.lastRequired,
});
const HARD = hardDependencyCeiling({
  softHighWater: SOFT,
  lastSubmittedSample: HUMAN.lastSubmitted,
  currentTargetRequiredSample: FORMULA,
  maxReorderSamples: HUMAN.maxReorder,
  prefetch: HUMAN.prefetch,
});

describe("AFE-20 A–H SOFT freeze after recreate must not hide sample 81", () => {
  let restore: (() => void) | undefined;
  afterEach(() => {
    restore?.();
    restore = undefined;
  });

  it("A. human shape: sample 81 PTS 3416667, queue 15, lastDecoded 2500000, lastSubmitted 75 < 81", () => {
    expect(SOFT).toBe(15);
    expect(FORMULA).toBe(90);
    expect(HARD).toBe(25);
    expect(HUMAN.lastSubmitted).toBeLessThan(HUMAN.sample);
    expect(HUMAN.lastSubmitted).toBeLessThan(FORMULA);
    expect(HUMAN.decodeQueue).toBe(SOFT);
    expect(HUMAN.lastDecodedTs).toBeLessThan(HUMAN.ptsUs);
    expect(
      lastRequiredDecodeSample({
        lastRequested: HUMAN.sample,
        maxReorderSamples: HUMAN.maxReorder,
        prefetch: HUMAN.prefetch,
        sampleCount: 240,
      }),
    ).toBe(FORMULA);
  });

  it("B. earlierKeyframeRecovered=no is correct when gopStart 0 — escape ineligible", () => {
    expect(
      mayEarlierKeyframeRecover({
        frozenHighWaterAfterRecreate: true,
        earlierKeyframeOrigin: null,
        earlierKeyframeRecovered: false,
        gopKeyframeStart: 0,
        earlierKeyframeAvailable: false,
      }),
    ).toBe(false);
    expect(
      mayEarlierKeyframeRecover({
        frozenHighWaterAfterRecreate: true,
        earlierKeyframeOrigin: 0,
        earlierKeyframeRecovered: false,
        gopKeyframeStart: 0,
        earlierKeyframeAvailable: true,
      }),
    ).toBe(false);
  });

  it("C. REGRESSION: frozen at SOFT 15, lastSubmitted 75 < live 90, queue < HARD 25 → advance", () => {
    expect(
      mayAdvancePastSoftFreeze({
        frozenAtSoftHighWater: true,
        lastSubmittedSample: HUMAN.lastSubmitted,
        currentTargetRequiredSample: FORMULA,
        decodeQueueSize: HUMAN.decodeQueue,
        hardDependencyCeiling: HARD,
        exactReady: false,
      }),
    ).toBe(true);
    expect(HARD).toBeGreaterThan(SOFT);
    expect(HARD).toBeLessThan(40);
    expect(HARD).toBeLessThan(HUMAN.lastRequired);
  });

  it("D. stop when horizon submitted or HARD reached — no flood to 140", () => {
    expect(
      mayAdvancePastSoftFreeze({
        frozenAtSoftHighWater: true,
        lastSubmittedSample: FORMULA,
        currentTargetRequiredSample: FORMULA,
        decodeQueueSize: HUMAN.decodeQueue,
        hardDependencyCeiling: SOFT,
        exactReady: false,
      }),
    ).toBe(false);
    expect(
      mayAdvancePastSoftFreeze({
        frozenAtSoftHighWater: true,
        lastSubmittedSample: HUMAN.lastSubmitted,
        currentTargetRequiredSample: FORMULA,
        decodeQueueSize: HARD,
        hardDependencyCeiling: HARD,
        exactReady: false,
      }),
    ).toBe(false);
  });

  it("E. dump ledger is at the front so one EXE screenshot has lastSubmitted/HARD/targetPtsSeen", () => {
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
      decodeQueueHighWater: SOFT,
      softHighWater: SOFT,
      hardDependencyCeiling: HARD,
      gopKeyframeStart: 0,
      earlierKeyframeAvailable: false,
      earlierKeyframeRecovered: false,
      postRecreateSubmitted: 76,
      postRecreateOutputs: 60,
      pumpSliceStart: 76,
      pumpSliceEnd: 75,
      frozenAtHighWater: true,
      backpressureBlocked: true,
      stallPhase: "WAIT_EXACT_PTS",
      stalledMs: 3000,
      decoderRecreateCount: 1,
      recoveryAttempts: 1,
    });
    const head = text.slice(0, 420);
    expect(head).toContain("requested sample 81 PTS 3416667");
    expect(head).toContain("lastSubmittedSample 75");
    expect(head).toContain("requestedSubmitted no");
    expect(head).toContain("currentTargetRequiredSample 90");
    expect(head).toContain("formulaTargetRequiredSample 90");
    expect(head).toContain("softHighWater 15");
    expect(head).toContain("hardDependencyCeiling 25");
    expect(head).toContain("targetPtsSeen no");
    expect(head).toContain("gopStart 0");
    expect(head).toContain("earlierKeyframeAvailable no");
    expect(head).toContain("earlierKeyframeRecovered no");
    expect(head).toContain("postRecreateSubmitted 76");
    expect(head).toContain("pumpSlice 76-75");
    expect(text).not.toMatch(/nearest|snap|allowSkip|Mediabunny|HTMLVideo/i);
  });

  it("F. after recreate, SOFT freeze with 75<81 still borrows to the requested sample", async () => {
    const movie = loadMovie(LONG);
    expect(movie).not.toBeNull();
    restore = installControllableQueueDecoder();
    const decoder = new AfeVideoDecoder({ ...movie!, maxReorderSamples: HUMAN.maxReorder });
    await decoder.ensure();
    decoder.setPrefetchHint(HUMAN.prefetch);
    decoder.beginStream(new Uint8Array(movie!.sampleCount).fill(1), 0, {
      lastRequested: 120,
      lastRequiredDecodeSample: HUMAN.lastRequired,
      requestedIndexes: [HUMAN.sample],
    });
    const targetPts = decoder.chunkTimestampUs(movie!.samples[HUMAN.sample]!);
    decoder.openRequested(HUMAN.sample, targetPts);
    decoder.setGopKeyframeStart(0);
    await decoder.recreate();
    decoder.setGopKeyframeStart(0);
    decoder.beginStream(new Uint8Array(movie!.sampleCount).fill(1), 0, {
      lastRequested: 120,
      lastRequiredDecodeSample: HUMAN.lastRequired,
      requestedIndexes: [HUMAN.sample],
      keepResolved: true,
    });
    decoder.restoreOpenedIdentity(HUMAN.sample, targetPts);
    decoder.clearRecoveryRebuilding([HUMAN.sample]);
    for (let i = 0; i <= 60; i++) decoder.submitEncoded(movie!.samples[i]!);
    decoder.deliverOutputForTest(HUMAN.lastDecodedTs);
    for (let i = 61; i <= HUMAN.lastSubmitted; i++) decoder.submitEncoded(movie!.samples[i]!);
    const mock = ControllableQueueDecoder.last!;
    mock.decodeQueueSize = HUMAN.decodeQueue;
    expect(decoder.softHighWater).toBe(SOFT);
    expect(decoder.snapshot().lastSubmittedSample).toBe(HUMAN.lastSubmitted);
    expect(decoder.canBorrowTowardLocalHorizon(HUMAN.sample)).toBe(true);
    expect(decoder.earlierKeyframeIsAvailable()).toBe(false);
    let next = HUMAN.lastSubmitted + 1;
    const hard = decoder.effectiveHardCeilingFor(HUMAN.sample);
    while (next <= HUMAN.sample) {
      const allow = await decoder.waitForDecodeCapacity(undefined, {
        requested: HUMAN.sample,
        budgetEnd: nowMs() + 40,
      });
      if (!allow) break;
      decoder.submitEncoded(movie!.samples[next]!);
      next += 1;
      expect(mock.decodeQueueSize).toBeLessThanOrEqual(hard);
    }
    expect(decoder.snapshot().lastSubmittedSample).toBeGreaterThanOrEqual(HUMAN.sample);
    expect(decoder.snapshot().lastSubmittedSample).toBeLessThan(HUMAN.lastRequired);
    expect(decoder.snapshot().decoderFlushCount).toBe(0);
    decoder.close();
  }, 10_000);

  it("G. lastSubmitted >= requested allows formula-horizon drain (packet is in)", () => {
    expect(
      mayLocalHorizonFinalFlush({
        unresolvedRequestedVideoFrames: 1,
        lastSubmittedSample: HUMAN.sample,
        currentTargetRequiredSample: FORMULA,
        formulaTargetRequiredSample: FORMULA,
        requestedSample: HUMAN.sample,
        exactReady: false,
        targetPtsSeen: false,
        decodeQueueSize: HUMAN.decodeQueue,
        outputProgressed: false,
        lastDecodedTimestamp: HUMAN.lastDecodedTs,
        targetPtsUs: HUMAN.ptsUs,
      }),
    ).toBe(true);
    expect(
      mayLocalHorizonFinalFlush({
        unresolvedRequestedVideoFrames: 1,
        lastSubmittedSample: HUMAN.lastSubmitted,
        currentTargetRequiredSample: FORMULA,
        formulaTargetRequiredSample: FORMULA,
        requestedSample: HUMAN.sample,
        exactReady: false,
        targetPtsSeen: false,
        decodeQueueSize: HUMAN.decodeQueue,
        outputProgressed: false,
        lastDecodedTimestamp: HUMAN.lastDecodedTs,
        targetPtsUs: HUMAN.ptsUs,
      }),
    ).toBe(false);
  });

  it("H. no timeout / SOFT / snap change", () => {
    expect(SOFT).toBe(15);
    expect(decodeQueueHighWater(HUMAN.maxReorder, HUMAN.prefetch, { afterRecreate: true })).toBe(15);
  });
});
