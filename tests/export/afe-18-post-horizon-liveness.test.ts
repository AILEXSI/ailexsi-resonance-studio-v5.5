import { existsSync, readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import {
  AFE_DECODE_QUEUE_HIGH_WATER_CAP,
  AFE_DECODE_STALL_MS,
  AfeVideoDecoder,
  currentTargetRequiredSample,
  decodeQueueHighWater,
  formatStallMessage,
  hardDependencyCeiling,
  lastRequiredDecodeSample,
  mayBorrowHardDependencyCredits,
  mayFinalFlush,
  mayLocalHorizonFinalFlush,
  maySubmitEncoded,
  nowMs,
  parseIsoBmff,
  postHorizonRequiredSample,
} from "../../src/core/frame-engine";
import {
  ControllableQueueDecoder,
  installControllableQueueDecoder,
} from "./afe-videodecoder-mock";

const LONG = "tests/fixtures/afe/afe-cfr-30-g60-8s.mp4";

/** Real QA dump — clip B after VIS, AFE-17 @ f40fcb9. */
const QA = {
  sample: 61,
  ptsUs: 2_583_333,
  lastDecodedTs: 2_208_333,
  lastSubmitted: 67,
  formulaTarget: 67,
  lastRequired: 102,
  decodeQueue: 12,
  soft: 12,
  maxReorder: 2,
  prefetch: 4,
};

function loadMovie(path: string) {
  if (!existsSync(path)) return null;
  return parseIsoBmff(new Uint8Array(readFileSync(path)));
}

const FORMULA = currentTargetRequiredSample({
  requested: QA.sample,
  maxReorderSamples: QA.maxReorder,
  prefetch: QA.prefetch,
  sampleCount: 240,
  lastRequiredDecodeSample: QA.lastRequired,
});

const LIVE = postHorizonRequiredSample({
  requested: QA.sample,
  currentTargetRequiredSample: FORMULA,
  lastSubmittedSample: QA.lastSubmitted,
  lastRequiredDecodeSample: QA.lastRequired,
  maxReorderSamples: QA.maxReorder,
  prefetch: QA.prefetch,
  sampleCount: 240,
  exactReady: false,
  targetPtsSeen: false,
  lastDecodedTimestamp: QA.lastDecodedTs,
  targetPtsUs: QA.ptsUs,
});

const HARD = hardDependencyCeiling({
  softHighWater: QA.soft,
  lastSubmittedSample: QA.lastSubmitted,
  currentTargetRequiredSample: LIVE,
  maxReorderSamples: QA.maxReorder,
  prefetch: QA.prefetch,
});

describe("AFE-18 A–J post-horizon liveness / bounded local advance", () => {
  let restore: (() => void) | undefined;
  afterEach(() => {
    restore?.();
    restore = undefined;
  });

  it("A. QA dump: lastSubmitted 67 >= formula 67 >= requested 61; lastDecoded 2208333 < 2583333", () => {
    expect(QA.lastSubmitted).toBeGreaterThanOrEqual(QA.formulaTarget);
    expect(QA.formulaTarget).toBeGreaterThanOrEqual(QA.sample);
    expect(QA.lastDecodedTs).toBeLessThan(QA.ptsUs);
    expect(QA.lastSubmitted).toBeLessThan(QA.lastRequired);
    const text = formatStallMessage({
      sourceSampleRequested: QA.sample,
      requestedSample: QA.sample,
      requestedPtsUs: QA.ptsUs,
      lastSubmittedSample: QA.lastSubmitted,
      lastRequiredDecodeSample: QA.lastRequired,
      currentTargetRequiredSample: LIVE,
      lastDecodedTimestamp: QA.lastDecodedTs,
      targetPtsUs: QA.ptsUs,
      targetPtsSeen: false,
      decodeQueueSize: QA.decodeQueue,
      decodeQueueHighWater: QA.soft,
      softHighWater: QA.soft,
      hardDependencyCeiling: HARD,
      maxReorderSamples: QA.maxReorder,
      prefetch: QA.prefetch,
      frozenAtHighWater: true,
      backpressureBlocked: true,
      noMoreSubmission: true,
      finalFlushAttempted: true,
      unresolvedRequestedVideoFrames: 1,
      videoFramesRequested: 46,
      videoFramesDecoded: 45,
      videoFramesEncoded: 45,
      postRecreateSubmitted: 68,
      postRecreateOutputs: 52,
      submittedMinusOutputs: 16,
      cancelledSpeculativeSamples: 15,
      pumpSliceStart: 68,
      pumpSliceEnd: 67,
      firstSubmittedAfterRecreate: 0,
      firstSubmittedAfterRecreateKey: true,
      packetParity: true,
      configParity: true,
      stallPhase: "WAIT_EXACT_PTS",
      stalledMs: 3000,
    });
    expect(text).toContain("requested sample 61 PTS 2583333");
    expect(text).toContain("lastSubmittedSample 67");
    expect(text).toContain("lastRequiredDecodeSample 102");
    expect(text).toContain("lastDecodedTs 2208333");
    expect(text).toContain("targetPtsSeen no");
    expect(text).toContain("softHighWater 12");
    expect(text).toContain(`hardDependencyCeiling ${HARD}`);
    expect(HARD).toBeGreaterThan(QA.soft);
    expect(text).not.toMatch(/nearest|snap|allowSkip|Mediabunny|HTMLVideo/i);
  });

  it("B. formula LOCAL for sample 61 is 67; dump-proven true required is 77, not 102", () => {
    expect(FORMULA).toBe(67);
    expect(
      lastRequiredDecodeSample({
        lastRequested: QA.sample,
        maxReorderSamples: QA.maxReorder,
        prefetch: QA.prefetch,
        sampleCount: 240,
      }),
    ).toBe(67);
    expect(LIVE).toBe(77);
    expect(LIVE).toBeGreaterThan(FORMULA);
    expect(LIVE).toBeLessThan(QA.lastRequired);
    expect(LIVE).toBeLessThan(140);
    expect(
      postHorizonRequiredSample({
        requested: QA.sample,
        currentTargetRequiredSample: FORMULA,
        lastSubmittedSample: QA.lastSubmitted,
        lastRequiredDecodeSample: QA.lastRequired,
        maxReorderSamples: QA.maxReorder,
        prefetch: QA.prefetch,
        sampleCount: 240,
        exactReady: false,
        targetPtsSeen: false,
        lastDecodedTimestamp: null,
        targetPtsUs: QA.ptsUs,
      }),
    ).toBe(FORMULA);
  });

  it("C. HARD==SOFT in the dump is remaining=0 on the formula; live target lifts HARD", () => {
    expect(
      hardDependencyCeiling({
        softHighWater: QA.soft,
        lastSubmittedSample: QA.lastSubmitted,
        currentTargetRequiredSample: FORMULA,
        maxReorderSamples: QA.maxReorder,
        prefetch: QA.prefetch,
      }),
    ).toBe(QA.soft);
    expect(HARD).toBe(22);
    expect(HARD).toBeGreaterThan(QA.soft);
    expect(HARD).toBeLessThan(40);
    expect(HARD).toBeLessThan(AFE_DECODE_QUEUE_HIGH_WATER_CAP);
    expect(HARD).toBeLessThan(QA.lastRequired);
    expect(decodeQueueHighWater(QA.maxReorder, QA.prefetch, { afterRecreate: true })).toBe(12);
    expect(AFE_DECODE_STALL_MS).toBe(3000);
  });

  it("D. REGRESSION: lastSubmitted>=formula, exact not ready, queue=SOFT, no progress → borrow toward 77", () => {
    expect(
      mayBorrowHardDependencyCredits({
        exactReady: false,
        usefulInputRemains: true,
        currentTargetRequiredSample: LIVE,
        lastSubmittedSample: QA.lastSubmitted,
        outputProgressed: false,
        decodeQueueSize: QA.decodeQueue,
        softHighWater: QA.soft,
        hardDependencyCeiling: HARD,
      }),
    ).toBe(true);
    expect(
      maySubmitEncoded({
        decodeQueueSize: QA.decodeQueue,
        highWater: QA.soft,
        outputProgressed: false,
        paused: true,
        exactReady: false,
        mustBorrowHardDependencyCredits: true,
        hardDependencyCeiling: HARD,
      }),
    ).toBe(true);
    expect(
      mayBorrowHardDependencyCredits({
        exactReady: false,
        usefulInputRemains: true,
        currentTargetRequiredSample: FORMULA,
        lastSubmittedSample: QA.lastSubmitted,
        outputProgressed: false,
        decodeQueueSize: QA.decodeQueue,
        softHighWater: QA.soft,
        hardDependencyCeiling: QA.soft,
      }),
    ).toBe(false);
  });

  it("E. transaction FINAL_FLUSH still illegal at 67<102; local-horizon drain is allowed", () => {
    expect(
      mayFinalFlush({
        unresolvedRequestedVideoFrames: 1,
        nextDecode: 68,
        sampleCount: 240,
        lastRequiredDecodeSample: QA.lastRequired,
        lastSubmittedSample: QA.lastSubmitted,
      }),
    ).toBe(false);
    expect(
      mayLocalHorizonFinalFlush({
        unresolvedRequestedVideoFrames: 1,
        lastSubmittedSample: LIVE,
        currentTargetRequiredSample: LIVE,
        exactReady: false,
        targetPtsSeen: false,
        decodeQueueSize: QA.decodeQueue,
        outputProgressed: false,
        lastDecodedTimestamp: QA.lastDecodedTs,
        targetPtsUs: QA.ptsUs,
      }),
    ).toBe(true);
    expect(
      mayLocalHorizonFinalFlush({
        unresolvedRequestedVideoFrames: 1,
        lastSubmittedSample: QA.lastSubmitted,
        currentTargetRequiredSample: LIVE,
        exactReady: false,
        targetPtsSeen: false,
        decodeQueueSize: QA.decodeQueue,
        outputProgressed: false,
        lastDecodedTimestamp: QA.lastDecodedTs,
        targetPtsUs: QA.ptsUs,
      }),
    ).toBe(false);
  });

  it("F. waitForDecodeCapacity after formula horizon + stuck lastDecoded borrows up to HARD, never 102", async () => {
    const movie = loadMovie(LONG);
    expect(movie).not.toBeNull();
    restore = installControllableQueueDecoder();
    const decoder = new AfeVideoDecoder({ ...movie!, maxReorderSamples: QA.maxReorder });
    await decoder.ensure();
    decoder.setPrefetchHint(QA.prefetch);
    decoder.beginStream(new Uint8Array(movie!.sampleCount).fill(1), 0, {
      lastRequested: 96,
      lastRequiredDecodeSample: QA.lastRequired,
      requestedIndexes: [QA.sample],
    });
    const targetPts = decoder.chunkTimestampUs(movie!.samples[QA.sample]!);
    const stuckPts = decoder.chunkTimestampUs(movie!.samples[52]!);
    decoder.openRequested(QA.sample, targetPts);
    decoder.setGopKeyframeStart(0);
    await decoder.recreate();
    decoder.setGopKeyframeStart(0);
    decoder.beginStream(new Uint8Array(movie!.sampleCount).fill(1), 0, {
      lastRequested: 96,
      lastRequiredDecodeSample: QA.lastRequired,
      requestedIndexes: [QA.sample],
      keepResolved: true,
    });
    decoder.restoreOpenedIdentity(QA.sample, targetPts);
    decoder.clearRecoveryRebuilding([QA.sample]);
    expect(decoder.snapshot().finalFlushAttempted).toBe(false);
    for (let i = 0; i <= 52; i++) decoder.submitEncoded(movie!.samples[i]!);
    decoder.deliverOutputForTest(stuckPts);
    for (let i = 53; i <= QA.lastSubmitted; i++) decoder.submitEncoded(movie!.samples[i]!);
    const mock = ControllableQueueDecoder.last!;
    mock.drain(Math.max(0, mock.decodeQueueSize - QA.soft), false);
    expect(decoder.formulaTargetRequiredFor(QA.sample)).toBe(FORMULA);
    expect(decoder.currentTargetRequiredFor(QA.sample)).toBe(LIVE);
    expect(decoder.hardDependencyCeilingFor(QA.sample)).toBe(HARD);
    expect(decoder.snapshot({ sourceSampleRequested: QA.sample }).hardDependencyCeiling).toBeGreaterThan(
      decoder.softHighWater,
    );
    const can = await decoder.waitForDecodeCapacity(undefined, {
      requested: QA.sample,
      budgetEnd: nowMs() + 40,
    });
    expect(can).toBe(true);
    let next = QA.lastSubmitted + 1;
    let peak = mock.decodeQueueSize;
    const hard = decoder.hardDependencyCeilingFor(QA.sample);
    while (next <= LIVE) {
      const allow = await decoder.waitForDecodeCapacity(undefined, {
        requested: QA.sample,
        budgetEnd: nowMs() + 40,
      });
      if (!allow) break;
      decoder.submitEncoded(movie!.samples[next]!);
      next += 1;
      peak = Math.max(peak, mock.decodeQueueSize);
      expect(mock.decodeQueueSize).toBeLessThanOrEqual(hard);
      expect(decoder.snapshot().lastSubmittedSample).toBeLessThan(QA.lastRequired);
    }
    expect(decoder.snapshot().lastSubmittedSample).toBeGreaterThanOrEqual(LIVE);
    expect(decoder.snapshot().lastSubmittedSample).toBeLessThan(QA.lastRequired);
    expect(peak).toBeLessThanOrEqual(hard);
    expect(peak).toBeLessThan(QA.lastRequired);
    expect(decoder.decodeQueueHighWater).toBe(QA.soft);
    expect(decoder.snapshot().decoderFlushCount).toBe(0);
    decoder.close();
  }, 10_000);

  it("G. recreate / beginStream clears stale FINAL_FLUSH so this request can drain", async () => {
    const movie = loadMovie(LONG);
    expect(movie).not.toBeNull();
    restore = installControllableQueueDecoder();
    const decoder = new AfeVideoDecoder({ ...movie!, maxReorderSamples: QA.maxReorder });
    await decoder.ensure();
    decoder.setPrefetchHint(QA.prefetch);
    decoder.beginStream(new Uint8Array(movie!.sampleCount).fill(1), 0, {
      lastRequested: 40,
      lastRequiredDecodeSample: 46,
      requestedIndexes: [30],
    });
    decoder.openRequested(30, decoder.chunkTimestampUs(movie!.samples[30]!));
    decoder.armFinalFlush([30]);
    expect(decoder.snapshot().finalFlushAttempted).toBe(true);
    await decoder.recreate();
    expect(decoder.finalFlushConsumedThisDecoder).toBe(false);
    expect(decoder.snapshot().finalFlushArmed).toBe(false);
    decoder.beginStream(new Uint8Array(movie!.sampleCount).fill(1), 0, {
      lastRequested: 96,
      lastRequiredDecodeSample: QA.lastRequired,
      requestedIndexes: [QA.sample],
      keepResolved: true,
    });
    expect(decoder.finalFlushConsumedThisDecoder).toBe(false);
    const targetPts = decoder.chunkTimestampUs(movie!.samples[QA.sample]!);
    const stuckPts = decoder.chunkTimestampUs(movie!.samples[52]!);
    decoder.openRequested(QA.sample, targetPts);
    decoder.restoreOpenedIdentity(QA.sample, targetPts);
    decoder.clearRecoveryRebuilding([QA.sample]);
    for (let i = 0; i <= 52; i++) decoder.submitEncoded(movie!.samples[i]!);
    decoder.deliverOutputForTest(stuckPts);
    for (let i = 53; i <= QA.lastSubmitted; i++) decoder.submitEncoded(movie!.samples[i]!);
    const mock = ControllableQueueDecoder.last!;
    mock.drain(Math.max(0, mock.decodeQueueSize - QA.soft), false);
    decoder.armFinalFlush([QA.sample]);
    expect(decoder.finalFlushConsumedThisDecoder).toBe(true);
    expect(decoder.currentTargetRequiredFor(QA.sample)).toBe(LIVE);
    decoder.releaseStaleFinalFlushIfLiveHorizonOpen(QA.sample);
    expect(decoder.finalFlushConsumedThisDecoder).toBe(false);
    expect(decoder.snapshot().finalFlushArmed).toBe(false);
    decoder.close();
  }, 10_000);

  it("H. extended HARD reached + no progress → noMoreSubmission; no flood to lastRequired", async () => {
    const movie = loadMovie(LONG);
    expect(movie).not.toBeNull();
    restore = installControllableQueueDecoder();
    const decoder = new AfeVideoDecoder({ ...movie!, maxReorderSamples: QA.maxReorder });
    await decoder.ensure();
    decoder.setPrefetchHint(QA.prefetch);
    decoder.beginStream(new Uint8Array(movie!.sampleCount).fill(1), 0, {
      lastRequested: 96,
      lastRequiredDecodeSample: QA.lastRequired,
      requestedIndexes: [QA.sample],
    });
    const targetPts = decoder.chunkTimestampUs(movie!.samples[QA.sample]!);
    const stuckPts = decoder.chunkTimestampUs(movie!.samples[52]!);
    decoder.openRequested(QA.sample, targetPts);
    decoder.setGopKeyframeStart(0);
    await decoder.recreate();
    decoder.setGopKeyframeStart(0);
    decoder.beginStream(new Uint8Array(movie!.sampleCount).fill(1), 0, {
      lastRequested: 96,
      lastRequiredDecodeSample: QA.lastRequired,
      requestedIndexes: [QA.sample],
      keepResolved: true,
    });
    decoder.restoreOpenedIdentity(QA.sample, targetPts);
    decoder.clearRecoveryRebuilding([QA.sample]);
    for (let i = 0; i <= 52; i++) decoder.submitEncoded(movie!.samples[i]!);
    decoder.deliverOutputForTest(stuckPts);
    for (let i = 53; i <= QA.lastSubmitted; i++) decoder.submitEncoded(movie!.samples[i]!);
    const mock = ControllableQueueDecoder.last!;
    mock.drain(Math.max(0, mock.decodeQueueSize - QA.soft), false);
    const hard = decoder.hardDependencyCeilingFor(QA.sample);
    for (let i = QA.lastSubmitted + 1; i <= LIVE + 4 && i < movie!.sampleCount; i++) {
      const can = await decoder.waitForDecodeCapacity(undefined, {
        requested: QA.sample,
        budgetEnd: nowMs() + 40,
      });
      if (!can) break;
      decoder.submitEncoded(movie!.samples[i]!);
      expect(mock.decodeQueueSize).toBeLessThanOrEqual(hard);
    }
    const blocked = await decoder.waitForDecodeCapacity(undefined, {
      requested: QA.sample,
      budgetEnd: nowMs() + 40,
    });
    expect(blocked).toBe(false);
    const dump = decoder.snapshot({ sourceSampleRequested: QA.sample });
    expect(dump.noMoreSubmission || dump.backpressureBlocked || dump.frozenAtHighWater).toBe(true);
    expect(dump.lastSubmittedSample).toBeLessThan(QA.lastRequired);
    expect(mock.decodeQueueSize).toBeLessThanOrEqual(hard);
    expect(dump.decodeQueueHighWater).toBe(QA.soft);
    decoder.close();
  }, 10_000);

  it("I. snapshot diagnostics: live currentTarget 77, HARD 22 > SOFT 12", async () => {
    const movie = loadMovie(LONG);
    expect(movie).not.toBeNull();
    restore = installControllableQueueDecoder();
    const decoder = new AfeVideoDecoder({ ...movie!, maxReorderSamples: QA.maxReorder });
    await decoder.ensure();
    decoder.setPrefetchHint(QA.prefetch);
    decoder.beginStream(new Uint8Array(movie!.sampleCount).fill(1), 0, {
      lastRequested: 96,
      lastRequiredDecodeSample: QA.lastRequired,
      requestedIndexes: [QA.sample],
    });
    const targetPts = decoder.chunkTimestampUs(movie!.samples[QA.sample]!);
    const stuckPts = decoder.chunkTimestampUs(movie!.samples[52]!);
    decoder.openRequested(QA.sample, targetPts);
    await decoder.recreate();
    decoder.beginStream(new Uint8Array(movie!.sampleCount).fill(1), 0, {
      lastRequested: 96,
      lastRequiredDecodeSample: QA.lastRequired,
      requestedIndexes: [QA.sample],
      keepResolved: true,
    });
    decoder.restoreOpenedIdentity(QA.sample, targetPts);
    decoder.clearRecoveryRebuilding([QA.sample]);
    for (let i = 0; i <= 52; i++) decoder.submitEncoded(movie!.samples[i]!);
    decoder.deliverOutputForTest(stuckPts);
    for (let i = 53; i <= QA.lastSubmitted; i++) decoder.submitEncoded(movie!.samples[i]!);
    const mock = ControllableQueueDecoder.last!;
    mock.drain(Math.max(0, mock.decodeQueueSize - QA.soft), false);
    const dump = decoder.snapshot({ sourceSampleRequested: QA.sample });
    expect(dump.requestedSample).toBe(QA.sample);
    expect(dump.lastSubmittedSample).toBe(67);
    expect(dump.currentTargetRequiredSample).toBe(77);
    expect(dump.lastRequiredDecodeSample).toBe(102);
    expect(dump.softHighWater).toBe(12);
    expect(dump.hardDependencyCeiling).toBe(22);
    expect(dump.hardDependencyCeiling).toBeGreaterThan(dump.softHighWater);
    expect(dump.targetPtsSeen).toBe(false);
    expect(dump.prefetch).toBe(4);
    expect(dump.maxReorderSamples).toBe(2);
    decoder.close();
  }, 10_000);

  it("J. no timeout / SOFT / snap change; AFE-16 unused SOFT credits still work below HIGH", () => {
    expect(AFE_DECODE_STALL_MS).toBe(3000);
    expect(decodeQueueHighWater(2, 4, { afterRecreate: true })).toBe(12);
    expect(
      maySubmitEncoded({
        decodeQueueSize: 7,
        highWater: 12,
        outputProgressed: false,
        lowWater: 6,
        paused: true,
        exactReady: false,
        mustAdvanceTowardDependencyHorizon: true,
      }),
    ).toBe(true);
  });
});
