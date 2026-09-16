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
  livenessReopenDumpReason,
  mayHardHorizonReset,
  mayPostResetLivenessReopen,
  mustColdOpenVideoDecoder,
  parseIsoBmff,
  postHorizonRequiredSample,
} from "../../src/core/frame-engine";
import {
  ControllableQueueDecoder,
  installControllableQueueDecoder,
} from "./afe-videodecoder-mock";

const LONG = "tests/fixtures/afe/afe-cfr-30-g60-8s.mp4";

/** Human EXE @ dea72ca — fingerprintMatch yes, livenessReopen no. */
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

describe("AFE-24 A–F fingerprint match after reset must invoke liveness reopen", () => {
  let restore: (() => void) | undefined;
  afterEach(() => {
    restore?.();
    restore = undefined;
  });

  it("A. human gate: outputs after last submit ⇒ exhausted false, reopen still yes", () => {
    expect(SOFT).toBe(12);
    expect(HARD).toBe(22);
    expect(
      identicalPostResetFingerprint({
        beforeLastDecodedTs: HUMAN.lastDecodedTs,
        afterLastDecodedTs: HUMAN.lastDecodedTs,
        beforeOutputs: HUMAN.postRecreateOutputs,
        afterOutputs: HUMAN.postRecreateOutputs,
      }),
    ).toBe(true);
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
        frozenAtHighWater: false,
        lastDecodedTimestamp: HUMAN.lastDecodedTs,
        targetPtsUs: HUMAN.ptsUs,
      }),
    ).toBe(true);
    expect(
      livenessReopenDumpReason({
        livenessReopenUsed: false,
        hardHorizonResetUsed: true,
        identicalFingerprint: true,
        exactReady: false,
        targetPtsSeen: false,
        earlierKeyframeAvailable: false,
        lastDecodedTimestamp: HUMAN.lastDecodedTs,
        targetPtsUs: HUMAN.ptsUs,
      }),
    ).toBe("pending");
  });

  it("B. AFE-21 / Shape A / unseen-without-reset stay off", () => {
    expect(
      mayHardHorizonReset({
        exactReady: false,
        lastSubmittedSample: 36,
        requestedSample: 38,
        currentTargetRequiredSample: 44,
        decodeQueueSize: 21,
        hardDependencyCeiling: 20,
        outputProgressed: false,
        earlierKeyframeAvailable: false,
        recreateCount: 1,
        hardHorizonResetUsed: false,
      }),
    ).toBe(true);
    expect(
      mayPostResetLivenessReopen({
        exactReady: false,
        targetPtsSeen: false,
        hardHorizonResetUsed: false,
        livenessReopenUsed: false,
        earlierKeyframeAvailable: false,
        identicalFingerprint: true,
        decodeQueueSize: 21,
        softHighWater: SOFT,
        lastDecodedTimestamp: HUMAN.lastDecodedTs,
        targetPtsUs: HUMAN.ptsUs,
      }),
    ).toBe(false);
    expect(
      mustColdOpenVideoDecoder({ previousPictureKind: null, nextPictureKind: "video" }),
    ).toBe(false);
    expect(
      mustColdOpenVideoDecoder({ previousPictureKind: "video", nextPictureKind: "video" }),
    ).toBe(false);
  });

  it("C. REGRESSION: submit then emit 458333 ⇒ exhausted no, reopen executes once", async () => {
    const movie = loadMovie(LONG);
    expect(movie).not.toBeNull();
    restore = installControllableQueueDecoder();
    const decoder = new AfeVideoDecoder({ ...movie!, maxReorderSamples: HUMAN.maxReorder });
    await decoder.ensure();
    const targetPts = await seedAfterRecreate(decoder, movie!);
    for (let i = 0; i <= HUMAN.lastSubmitted; i++) decoder.submitEncoded(movie!.samples[i]!);
    decoder.deliverOutputForTest(HUMAN.lastDecodedTs);
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
    for (let i = 0; i <= HUMAN.lastSubmitted; i++) decoder.submitEncoded(movie!.samples[i]!);
    decoder.deliverOutputForTest(HUMAN.lastDecodedTs);
    const live = ControllableQueueDecoder.last!;
    live.decodeQueueSize = HUMAN.decodeQueue;
    expect(decoder.hasTargetPtsBeenSeen(targetPts)).toBe(false);
    expect(decoder.postResetFingerprintMatches()).toBe(true);
    expect(decoder.hardHorizonResetExhausted(HUMAN.sample)).toBe(false);
    expect(decoder.mayPostResetLivenessReopenFor(HUMAN.sample)).toBe(true);
    expect(decoder.livenessReopenConsumed).toBe(false);
    decoder.noteLivenessReopen();
    await decoder.coldReopenNativeDecoder();
    expect(decoder.livenessReopenConsumed).toBe(true);
    expect(decoder.mayPostResetLivenessReopenFor(HUMAN.sample)).toBe(false);
    expect(decoder.snapshot().livenessReopenUsed).toBe(true);
    expect(decoder.snapshot().livenessReopenReason).toBe("yes");
    expect(decoder.snapshot().lastSubmittedSample ?? -1).toBeLessThan(HUMAN.lastRequired);
    decoder.close();
  }, 10_000);

  it("D. dump after path runs shows livenessReopen yes; coldOpenAfterVis no on first video", () => {
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
      livenessReopenUsed: true,
      livenessReopenReason: "yes",
      coldOpenAfterVis: false,
      postRecreateSubmitted: 35,
      postRecreateOutputs: HUMAN.postRecreateOutputs,
      pumpSliceStart: 35,
      pumpSliceEnd: 34,
      frozenAtHighWater: true,
      stallPhase: "FINAL_FLUSH",
      stalledMs: 3000,
      decoderRecreateCount: 2,
      decoderResetCount: 2,
      visFrames: 0,
    });
    const head = text.slice(0, 860);
    expect(head).toContain("requested sample 28 PTS 1375000");
    expect(head).toContain("hardHorizonReset yes");
    expect(head).toContain("postResetFingerprintMatch yes");
    expect(head).toContain("livenessReopen yes");
    expect(head).toContain("livenessReopenReason yes");
    expect(head).toContain("coldOpenAfterVis no");
    expect(text).not.toMatch(/nearest|snap|allowSkip|Mediabunny|HTMLVideo/i);
  });
});
