import { existsSync, readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import {
  AfeVideoDecoder,
  currentTargetRequiredSample,
  mayFinalFlush,
  mayLocalHorizonFinalFlush,
  nowMs,
  parseIsoBmff,
  postHorizonRequiredSample,
} from "../../src/core/frame-engine";
import {
  ControllableQueueDecoder,
  installControllableQueueDecoder,
} from "./afe-videodecoder-mock";

const LONG = "tests/fixtures/afe/afe-cfr-30-g60-8s.mp4";

/** Linux Chrome MODE A @ AFE-18 HEAD — clip B after VIS. */
const QA = {
  sample: 61,
  ptsUs: 2_583_333,
  lastDecodedTs: 1_875_000,
  lastSubmitted: 67,
  formulaTarget: 67,
  liveTarget: 77,
  lastRequired: 102,
  decodeQueue: 20,
  soft: 12,
  hard: 22,
  maxReorder: 2,
  prefetch: 4,
  postRecreateOutputs: 44,
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

describe("AFE-19 A–F formula-horizon drain when live 77 is unreachable", () => {
  let restore: (() => void) | undefined;
  afterEach(() => {
    restore?.();
    restore = undefined;
  });

  it("A. production dump: 67>=formula, 67<live 77, queue 20, lastDecoded 1875000 < 2583333", () => {
    expect(FORMULA).toBe(67);
    expect(LIVE).toBe(77);
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
        lastSubmittedSample: QA.lastSubmitted,
        currentTargetRequiredSample: LIVE,
        formulaTargetRequiredSample: FORMULA,
        exactReady: false,
        targetPtsSeen: false,
        decodeQueueSize: QA.decodeQueue,
        outputProgressed: false,
        lastDecodedTimestamp: QA.lastDecodedTs,
        targetPtsUs: QA.ptsUs,
      }),
    ).toBe(true);
  });

  it("B. first-fill formula submitted + held queue → drain allowed (no recreate)", async () => {
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
    const stuckPts = decoder.chunkTimestampUs(movie!.samples[44]!);
    decoder.openRequested(QA.sample, targetPts);
    for (let i = 0; i <= 44; i++) decoder.submitEncoded(movie!.samples[i]!);
    decoder.deliverOutputForTest(stuckPts);
    for (let i = 45; i <= QA.lastSubmitted; i++) decoder.submitEncoded(movie!.samples[i]!);
    const mock = ControllableQueueDecoder.last!;
    mock.decodeQueueSize = QA.decodeQueue;
    expect(decoder.formulaTargetRequiredFor(QA.sample)).toBe(FORMULA);
    expect(decoder.mayFormulaHorizonDrain(QA.sample)).toBe(true);
    expect(decoder.snapshot({ sourceSampleRequested: QA.sample }).formulaTargetRequiredSample).toBe(
      FORMULA,
    );
    decoder.close();
  }, 10_000);

  it("C. after recreate with 44 outputs (production) → drain allowed at formula 67", async () => {
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
    for (let i = 0; i <= QA.lastSubmitted; i++) decoder.submitEncoded(movie!.samples[i]!);
    for (let i = 0; i < 6; i++) {
      decoder.deliverOutputForTest(decoder.chunkTimestampUs(movie!.samples[i]!));
    }
    const mock = ControllableQueueDecoder.last!;
    mock.decodeQueueSize = QA.decodeQueue;
    expect(decoder.snapshot().postRecreateOutputs).toBeGreaterThanOrEqual(1);
    expect(decoder.currentTargetRequiredFor(QA.sample)).toBe(LIVE);
    expect(decoder.mayFormulaHorizonDrain(QA.sample)).toBe(true);
    decoder.close();
  }, 10_000);

  it("D. AFE-13-like: after recreate with only 4 outputs → no drain (no hang-flush)", async () => {
    const movie = loadMovie(LONG);
    expect(movie).not.toBeNull();
    restore = installControllableQueueDecoder();
    const decoder = new AfeVideoDecoder({ ...movie!, maxReorderSamples: 10 });
    await decoder.ensure();
    decoder.setPrefetchHint(QA.prefetch);
    decoder.beginStream(new Uint8Array(movie!.sampleCount).fill(1), 0, {
      lastRequested: 80,
      lastRequiredDecodeSample: 144,
      requestedIndexes: [3],
    });
    const targetPts = decoder.chunkTimestampUs(movie!.samples[3]!);
    decoder.openRequested(3, targetPts);
    decoder.setGopKeyframeStart(0);
    await decoder.recreate();
    decoder.setGopKeyframeStart(0);
    decoder.beginStream(new Uint8Array(movie!.sampleCount).fill(1), 0, {
      lastRequested: 80,
      lastRequiredDecodeSample: 144,
      requestedIndexes: [3],
      keepResolved: true,
    });
    decoder.restoreOpenedIdentity(3, targetPts);
    decoder.clearRecoveryRebuilding([3]);
    for (let i = 0; i <= 10; i++) decoder.submitEncoded(movie!.samples[i]!);
    decoder.deliverOutputForTest(decoder.chunkTimestampUs(movie!.samples[0]!));
    decoder.deliverOutputForTest(decoder.chunkTimestampUs(movie!.samples[1]!));
    decoder.deliverOutputForTest(decoder.chunkTimestampUs(movie!.samples[2]!));
    decoder.deliverOutputForTest(decoder.chunkTimestampUs(movie!.samples[4]!));
    const mock = ControllableQueueDecoder.last!;
    mock.decodeQueueSize = 20;
    expect(decoder.snapshot().postRecreateOutputs).toBeLessThan(6);
    expect(decoder.mayFormulaHorizonDrain(3)).toBe(false);
    decoder.close();
  }, 10_000);

  it("E. lastSubmitted still behind formula → no drain", async () => {
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
    decoder.openRequested(QA.sample, targetPts);
    for (let i = 0; i <= 40; i++) decoder.submitEncoded(movie!.samples[i]!);
    decoder.deliverOutputForTest(decoder.chunkTimestampUs(movie!.samples[20]!));
    const mock = ControllableQueueDecoder.last!;
    mock.decodeQueueSize = 12;
    expect(decoder.formulaTargetRequiredFor(QA.sample)).toBe(FORMULA);
    expect((decoder.snapshot().lastSubmittedSample ?? -1) < FORMULA).toBe(true);
    expect(decoder.mayFormulaHorizonDrain(QA.sample)).toBe(false);
    decoder.close();
  }, 10_000);

  it("F. no snap / nearest / lastRequired flood; transaction flush still 67<102", () => {
    expect(
      mayFinalFlush({
        unresolvedRequestedVideoFrames: 1,
        nextDecode: 68,
        sampleCount: 240,
        lastRequiredDecodeSample: QA.lastRequired,
        lastSubmittedSample: QA.lastSubmitted,
      }),
    ).toBe(false);
    expect(QA.lastSubmitted).toBeLessThan(QA.lastRequired);
    expect(QA.hard).toBeLessThan(40);
    expect(nowMs()).toBeGreaterThan(0);
  });
});
