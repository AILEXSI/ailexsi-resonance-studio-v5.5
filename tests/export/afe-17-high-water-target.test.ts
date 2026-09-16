import { existsSync, readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import {
  AFE_DECODE_QUEUE_HIGH_WATER_CAP,
  AFE_DECODE_QUEUE_RECOVERY_FILL,
  AFE_DECODE_STALL_MS,
  AfeVideoDecoder,
  currentTargetRequiredSample,
  decodeQueueHighWater,
  decodeQueueLowWater,
  formatStallMessage,
  hardDependencyCeiling,
  hasFurtherUsefulInput,
  lastRequiredDecodeSample,
  mayBorrowHardDependencyCredits,
  mayResumeDecode,
  maySubmitEncoded,
  mustAdvanceTowardDependencyHorizon,
  nowMs,
  parseIsoBmff,
  pumpSliceMatchesSubmitProvenance,
} from "../../src/core/frame-engine";
import {
  ControllableQueueDecoder,
  installControllableQueueDecoder,
} from "./afe-videodecoder-mock";

const LONG = "tests/fixtures/afe/afe-cfr-30-g60-8s.mp4";

/** Windows AFE-17 human stall — SOFT HIGH reached before requested 43. */
const HUMAN = {
  sample: 43,
  ptsUs: 2_000_000,
  lastDecodedTs: 1_000_000,
  lastSubmitted: 40,
  lastRequired: 140,
  decodeQueue: 12,
  low: 6,
  high: 12,
  maxReorder: 2,
  prefetch: 4,
  stalePumpStart: 92,
  stalePumpEnd: 97,
  submitFrom: 41,
  submitTo: 40,
};

function loadMovie(path: string) {
  if (!existsSync(path)) return null;
  return parseIsoBmff(new Uint8Array(readFileSync(path)));
}

const LOCAL = currentTargetRequiredSample({
  requested: HUMAN.sample,
  maxReorderSamples: HUMAN.maxReorder,
  prefetch: HUMAN.prefetch,
  sampleCount: 240,
  lastRequiredDecodeSample: HUMAN.lastRequired,
});

const HARD = hardDependencyCeiling({
  softHighWater: HUMAN.high,
  lastSubmittedSample: HUMAN.lastSubmitted,
  currentTargetRequiredSample: LOCAL,
  maxReorderSamples: HUMAN.maxReorder,
  prefetch: HUMAN.prefetch,
  afterRecreate: true,
});

const REGRESSION = {
  lastSubmittedSample: HUMAN.lastSubmitted,
  currentTargetRequiredSample: LOCAL,
  decodeQueueSize: HUMAN.decodeQueue,
  softHighWater: HUMAN.high,
  hardDependencyCeiling: HARD,
  exactReady: false,
  usefulInputRemains: true,
  outputProgressed: false,
  afterRecreate: true,
};

describe("AFE-17 A–L HIGH_WATER target reachability / bounded dependency credits", () => {
  let restore: (() => void) | undefined;
  afterEach(() => {
    restore?.();
    restore = undefined;
  });

  it("A. human stall: requested 43 PTS 2000000, submitted 40, queue=SOFT 12, lastRequired 140", () => {
    const text = formatStallMessage({
      sourceSampleRequested: HUMAN.sample,
      requestedSample: HUMAN.sample,
      requestedPtsUs: HUMAN.ptsUs,
      lastSubmittedSample: HUMAN.lastSubmitted,
      lastRequiredDecodeSample: HUMAN.lastRequired,
      currentTargetRequiredSample: LOCAL,
      lastDecodedTimestamp: HUMAN.lastDecodedTs,
      decodeQueueSize: HUMAN.decodeQueue,
      decodeQueueLowWater: HUMAN.low,
      decodeQueueHighWater: HUMAN.high,
      softHighWater: HUMAN.high,
      hardDependencyCeiling: HARD,
      maxReorderSamples: HUMAN.maxReorder,
      prefetch: HUMAN.prefetch,
      lookahead: 6,
      pumpSliceStart: HUMAN.submitFrom,
      pumpSliceEnd: HUMAN.submitTo,
      frozenAtHighWater: true,
      backpressureBlocked: true,
      noMoreSubmission: true,
      usefulInputExhausted: false,
      targetPtsSeen: false,
      packetParity: true,
      configParity: true,
      firstSubmittedAfterRecreate: 0,
      firstSubmittedAfterRecreateKey: true,
      postRecreateSubmitted: 41,
      postRecreateOutputs: 23,
      submittedMinusOutputs: 18,
      stallPhase: "PUMP_LOOKAHEAD",
      submitPhaseTraces: [
        {
          phase: "PUMP_LOOKAHEAD",
          submittedFrom: 0,
          submittedTo: 40,
          decodeQueueStart: 0,
          decodeQueueEnd: 12,
          lastDecodedStart: null,
          lastDecodedEnd: HUMAN.lastDecodedTs,
          pausedForCapacity: false,
          outputProgressed: true,
        },
        {
          phase: "PUMP_LOOKAHEAD",
          submittedFrom: HUMAN.submitFrom,
          submittedTo: HUMAN.submitTo,
          decodeQueueStart: 12,
          decodeQueueEnd: 12,
          lastDecodedStart: HUMAN.lastDecodedTs,
          lastDecodedEnd: HUMAN.lastDecodedTs,
          pausedForCapacity: true,
          outputProgressed: false,
        },
      ],
    });
    expect(text).toContain("requested sample 43 PTS 2000000");
    expect(text).toContain("requestedSample 43");
    expect(text).toContain("lastSubmittedSample 40 (sample-index)");
    expect(text).toContain("lastRequiredDecodeSample 140 (sample-index)");
    expect(text).toContain(`currentTargetRequiredSample ${LOCAL}`);
    expect(text).toContain("decodeQueue 12");
    expect(text).toContain("softHighWater 12");
    expect(text).toContain(`hardDependencyCeiling ${HARD}`);
    expect(text).toContain("prefetch 4");
    expect(text).toContain("maxReorderSamples 2");
    expect(text).toContain("frozenAtHighWater yes");
    expect(text).toContain("backpressureBlocked yes");
    expect(text).toContain("noMoreSubmission yes");
    expect(text).toContain("usefulInputExhausted no");
    expect(text).toContain("targetPtsSeen no");
    expect(text).toContain("packetParity yes");
    expect(text).toContain("configParity yes");
    expect(text).toContain("firstSubmittedAfterRecreate 0");
    expect(text).toContain("firstSubmittedAfterRecreateKey yes");
    expect(text).toContain("postRecreateSubmitted 41");
    expect(text).toContain("postRecreateOutputs 23");
    expect(text).toContain("submittedMinusOutputs 18");
    expect(text).toContain("PUMP_LOOKAHEAD:41-40/q12->12/ts1000000->1000000/paused");
    expect(HUMAN.sample).toBeGreaterThan(HUMAN.lastSubmitted);
  });

  it("B. LOCAL horizon for sample 43 / PTS 2000000 is lastRequired(43), not transaction 140", () => {
    expect(LOCAL).toBe(49);
    expect(LOCAL).toBeGreaterThan(HUMAN.lastSubmitted);
    expect(LOCAL).toBeGreaterThanOrEqual(HUMAN.sample);
    expect(LOCAL).toBeLessThan(HUMAN.lastRequired);
    expect(
      lastRequiredDecodeSample({
        lastRequested: HUMAN.sample,
        maxReorderSamples: HUMAN.maxReorder,
        prefetch: HUMAN.prefetch,
        sampleCount: 240,
      }),
    ).toBe(49);
    expect(
      currentTargetRequiredSample({
        requested: HUMAN.sample,
        maxReorderSamples: HUMAN.maxReorder,
        prefetch: HUMAN.prefetch,
        sampleCount: 240,
        lastRequiredDecodeSample: HUMAN.lastRequired,
      }),
    ).toBe(49);
    /* Decode-order input must reach 43 (the sample) and 49 (reorder+prefetch). */
    expect(HUMAN.lastSubmitted).toBeLessThan(HUMAN.sample);
    expect(49 - HUMAN.lastSubmitted).toBe(9);
  });

  it("C. SOFT vs HARD derivation: SOFT stays 12; HARD = SOFT + min(remaining, L+B)", () => {
    const soft = decodeQueueHighWater(HUMAN.maxReorder, HUMAN.prefetch, { afterRecreate: true });
    const low = decodeQueueLowWater(HUMAN.maxReorder, HUMAN.prefetch, { afterRecreate: true });
    expect(soft).toBe(HUMAN.high);
    expect(low).toBe(HUMAN.low);
    expect(HARD).toBe(21);
    expect(HARD).toBeGreaterThan(soft);
    expect(HARD).toBeLessThan(AFE_DECODE_QUEUE_RECOVERY_FILL);
    expect(HARD).toBeLessThan(AFE_DECODE_QUEUE_HIGH_WATER_CAP);
    expect(HARD).toBeLessThan(125);
    expect(HARD).toBeLessThan(HUMAN.lastRequired);
    expect(
      hardDependencyCeiling({
        softHighWater: HUMAN.high,
        lastSubmittedSample: HUMAN.lastSubmitted,
        currentTargetRequiredSample: HUMAN.lastRequired,
        maxReorderSamples: HUMAN.maxReorder,
        prefetch: HUMAN.prefetch,
        afterRecreate: true,
      }),
    ).toBeLessThan(40);
    expect(
      hardDependencyCeiling({
        softHighWater: HUMAN.high,
        lastSubmittedSample: HUMAN.lastSubmitted,
        currentTargetRequiredSample: LOCAL,
        maxReorderSamples: HUMAN.maxReorder,
        prefetch: HUMAN.prefetch,
        afterRecreate: false,
      }),
    ).toBe(HARD);
    expect(decodeQueueHighWater(HUMAN.maxReorder, HUMAN.prefetch, { afterRecreate: true })).toBe(12);
    expect(AFE_DECODE_STALL_MS).toBe(3000);
  });

  it("D. REGRESSION: requested=43, submitted=40, queue=SOFT 12 → must borrow toward LOCAL 49", () => {
    expect(HUMAN.sample).toBe(43);
    expect(HUMAN.lastSubmitted).toBe(40);
    expect(LOCAL).toBeGreaterThan(40);
    expect(HUMAN.decodeQueue).toBe(HUMAN.high);
    expect(REGRESSION.exactReady).toBe(false);
    expect(REGRESSION.usefulInputRemains).toBe(true);
    expect(mayBorrowHardDependencyCredits(REGRESSION)).toBe(true);
    expect(
      mustAdvanceTowardDependencyHorizon({
        lastSubmittedSample: HUMAN.lastSubmitted,
        lastRequiredDecodeSample: HUMAN.lastRequired,
        decodeQueueSize: HUMAN.decodeQueue,
        highWater: HUMAN.high,
        exactReady: false,
        usefulInputRemains: true,
      }),
    ).toBe(false);
    expect(
      maySubmitEncoded({
        decodeQueueSize: HUMAN.decodeQueue,
        highWater: HUMAN.high,
        outputProgressed: false,
        lowWater: HUMAN.low,
        paused: true,
        exactReady: false,
        mustAdvanceTowardDependencyHorizon: true,
      }),
    ).toBe(false);
    expect(
      maySubmitEncoded({
        decodeQueueSize: HUMAN.decodeQueue,
        highWater: HUMAN.high,
        outputProgressed: false,
        lowWater: HUMAN.low,
        paused: true,
        exactReady: false,
        mustBorrowHardDependencyCredits: true,
        hardDependencyCeiling: HARD,
      }),
    ).toBe(true);
    expect(
      mayResumeDecode({
        decodeQueueSize: HUMAN.decodeQueue,
        highWater: HUMAN.high,
        lowWater: HUMAN.low,
        exactReady: false,
        paused: true,
        mustBorrowHardDependencyCredits: true,
        hardDependencyCeiling: HARD,
      }),
    ).toBe(true);
  });

  it("E. lastRequired=140 is not permission to flood; emergency stops at LOCAL horizon / HARD", () => {
    expect(
      mayBorrowHardDependencyCredits({
        ...REGRESSION,
        currentTargetRequiredSample: HUMAN.lastSubmitted,
      }),
    ).toBe(false);
    expect(
      mayBorrowHardDependencyCredits({
        ...REGRESSION,
        decodeQueueSize: HARD,
      }),
    ).toBe(false);
    expect(
      mayBorrowHardDependencyCredits({
        ...REGRESSION,
        outputProgressed: true,
      }),
    ).toBe(true);
    expect(
      mayBorrowHardDependencyCredits({
        ...REGRESSION,
        exactReady: true,
      }),
    ).toBe(false);
    expect(
      mayBorrowHardDependencyCredits({
        ...REGRESSION,
        usefulInputRemains: false,
      }),
    ).toBe(false);
    expect(
      maySubmitEncoded({
        decodeQueueSize: HARD,
        highWater: HUMAN.high,
        outputProgressed: false,
        mustBorrowHardDependencyCredits: true,
        hardDependencyCeiling: HARD,
      }),
    ).toBe(false);
    expect(
      hasFurtherUsefulInput({
        nextDecode: LOCAL + 1,
        sampleCount: 240,
        lastRequiredDecodeSample: LOCAL,
      }),
    ).toBe(false);
  });

  it("F. waitForDecodeCapacity at SOFT HIGH borrows toward sample 43; queue never exceeds HARD", async () => {
    const movie = loadMovie(LONG);
    expect(movie).not.toBeNull();
    restore = installControllableQueueDecoder();
    const decoder = new AfeVideoDecoder({ ...movie!, maxReorderSamples: HUMAN.maxReorder });
    await decoder.ensure();
    decoder.setPrefetchHint(HUMAN.prefetch);
    decoder.beginStream(new Uint8Array(movie!.sampleCount).fill(1), 0, {
      lastRequested: 90,
      lastRequiredDecodeSample: HUMAN.lastRequired,
      requestedIndexes: [HUMAN.sample],
    });
    decoder.openRequested(HUMAN.sample, decoder.chunkTimestampUs(movie!.samples[HUMAN.sample]!));
    decoder.setGopKeyframeStart(0);
    await decoder.recreate();
    decoder.setGopKeyframeStart(0);
    decoder.beginStream(new Uint8Array(movie!.sampleCount).fill(1), 0, {
      lastRequested: 90,
      lastRequiredDecodeSample: HUMAN.lastRequired,
      requestedIndexes: [HUMAN.sample],
      keepResolved: true,
    });
    decoder.restoreOpenedIdentity(HUMAN.sample, decoder.chunkTimestampUs(movie!.samples[HUMAN.sample]!));
    expect(decoder.decodeQueueHighWater).toBe(HUMAN.high);
    expect(decoder.softHighWater).toBe(HUMAN.high);
    expect(decoder.currentTargetRequiredFor(HUMAN.sample)).toBe(LOCAL);
    for (let i = 0; i <= HUMAN.lastSubmitted; i++) decoder.submitEncoded(movie!.samples[i]!);
    const mock = ControllableQueueDecoder.last!;
    mock.drain(mock.decodeQueueSize - HUMAN.high, false);
    expect(mock.decodeQueueSize).toBe(HUMAN.high);
    expect(decoder.snapshot().lastSubmittedSample).toBe(HUMAN.lastSubmitted);
    decoder.setPumpSlice(HUMAN.stalePumpStart, HUMAN.stalePumpEnd);
    decoder.beginSubmitPhase("PUMP_LOOKAHEAD", HUMAN.lastSubmitted + 1);
    const can = await decoder.waitForDecodeCapacity(undefined, {
      requested: HUMAN.sample,
      budgetEnd: nowMs() + 40,
    });
    expect(can).toBe(true);
    let next = HUMAN.lastSubmitted + 1;
    let peak = mock.decodeQueueSize;
    const hard = decoder.hardDependencyCeilingFor(HUMAN.sample);
    expect(hard).toBe(HARD);
    while (next <= LOCAL) {
      const allow = await decoder.waitForDecodeCapacity(undefined, {
        requested: HUMAN.sample,
        budgetEnd: nowMs() + 40,
      });
      if (!allow) break;
      decoder.submitEncoded(movie!.samples[next]!);
      next += 1;
      peak = Math.max(peak, mock.decodeQueueSize);
      expect(mock.decodeQueueSize).toBeLessThanOrEqual(hard);
    }
    decoder.endSubmitPhase();
    expect(decoder.snapshot().lastSubmittedSample).toBeGreaterThanOrEqual(HUMAN.sample);
    expect(decoder.snapshot().lastSubmittedSample).toBeLessThan(HUMAN.lastRequired);
    expect(peak).toBeLessThanOrEqual(hard);
    expect(peak).toBeLessThan(40);
    expect(peak).toBeLessThan(125);
    expect(decoder.decodeQueueHighWater).toBe(HUMAN.high);
    expect(decoder.snapshot().decoderFlushCount).toBe(0);
    decoder.close();
  }, 10_000);

  it("G. pumpSlice provenance follows the last actual submit attempt, not stale 92-97", async () => {
    const movie = loadMovie(LONG);
    expect(movie).not.toBeNull();
    restore = installControllableQueueDecoder();
    const decoder = new AfeVideoDecoder({ ...movie!, maxReorderSamples: HUMAN.maxReorder });
    await decoder.ensure();
    decoder.setPrefetchHint(HUMAN.prefetch);
    decoder.beginStream(new Uint8Array(movie!.sampleCount).fill(1), 0, {
      lastRequested: 90,
      lastRequiredDecodeSample: HUMAN.lastRequired,
      requestedIndexes: [HUMAN.sample],
    });
    decoder.openRequested(HUMAN.sample, decoder.chunkTimestampUs(movie!.samples[HUMAN.sample]!));
    decoder.setGopKeyframeStart(0);
    await decoder.recreate();
    decoder.setGopKeyframeStart(0);
    decoder.beginStream(new Uint8Array(movie!.sampleCount).fill(1), 0, {
      lastRequested: 90,
      lastRequiredDecodeSample: HUMAN.lastRequired,
      requestedIndexes: [HUMAN.sample],
      keepResolved: true,
    });
    decoder.restoreOpenedIdentity(HUMAN.sample, decoder.chunkTimestampUs(movie!.samples[HUMAN.sample]!));
    for (let i = 0; i <= HUMAN.lastSubmitted; i++) decoder.submitEncoded(movie!.samples[i]!);
    const mock = ControllableQueueDecoder.last!;
    mock.drain(mock.decodeQueueSize - HUMAN.high, false);
    decoder.setPumpSlice(HUMAN.stalePumpStart, HUMAN.stalePumpEnd);
    expect(decoder.snapshot().pumpSliceStart).toBe(HUMAN.stalePumpStart);
    decoder.beginSubmitPhase("PUMP_LOOKAHEAD", HUMAN.submitFrom);
    decoder.endSubmitPhase();
    const dump = decoder.snapshot({ sourceSampleRequested: HUMAN.sample });
    expect(dump.pumpSliceStart).toBe(HUMAN.submitFrom);
    expect(dump.pumpSliceEnd).toBe(HUMAN.submitTo);
    expect(dump.pumpSliceStart).not.toBe(HUMAN.stalePumpStart);
    const last = dump.submitPhaseTraces[dump.submitPhaseTraces.length - 1]!;
    expect(last.submittedFrom).toBe(HUMAN.submitFrom);
    expect(last.submittedTo).toBe(HUMAN.submitTo);
    expect(
      pumpSliceMatchesSubmitProvenance({
        pumpSliceStart: dump.pumpSliceStart,
        pumpSliceEnd: dump.pumpSliceEnd,
        submitPhaseTraces: dump.submitPhaseTraces,
      }),
    ).toBe(true);
    const text = formatStallMessage(dump);
    expect(text).toContain("pumpSlice 41-40");
    expect(text).toContain("PUMP_LOOKAHEAD:41-40");
    expect(text).not.toContain("pumpSlice 92-97");
    decoder.close();
  }, 10_000);

  it("H. snapshot diagnostics include requested / local horizon / SOFT / HARD / credits", async () => {
    const movie = loadMovie(LONG);
    expect(movie).not.toBeNull();
    restore = installControllableQueueDecoder();
    const decoder = new AfeVideoDecoder({ ...movie!, maxReorderSamples: HUMAN.maxReorder });
    await decoder.ensure();
    decoder.setPrefetchHint(HUMAN.prefetch);
    decoder.beginStream(new Uint8Array(movie!.sampleCount).fill(1), 0, {
      lastRequested: 90,
      lastRequiredDecodeSample: HUMAN.lastRequired,
      requestedIndexes: [HUMAN.sample],
    });
    decoder.openRequested(HUMAN.sample, decoder.chunkTimestampUs(movie!.samples[HUMAN.sample]!));
    decoder.setGopKeyframeStart(0);
    await decoder.recreate();
    decoder.setGopKeyframeStart(0);
    decoder.beginStream(new Uint8Array(movie!.sampleCount).fill(1), 0, {
      lastRequested: 90,
      lastRequiredDecodeSample: HUMAN.lastRequired,
      requestedIndexes: [HUMAN.sample],
      keepResolved: true,
    });
    decoder.restoreOpenedIdentity(HUMAN.sample, decoder.chunkTimestampUs(movie!.samples[HUMAN.sample]!));
    for (let i = 0; i <= HUMAN.lastSubmitted; i++) decoder.submitEncoded(movie!.samples[i]!);
    const mock = ControllableQueueDecoder.last!;
    mock.drain(mock.decodeQueueSize - HUMAN.high, false);
    const dump = decoder.snapshot({ sourceSampleRequested: HUMAN.sample });
    expect(dump.requestedSample).toBe(HUMAN.sample);
    expect(dump.lastSubmittedSample).toBe(HUMAN.lastSubmitted);
    expect(dump.currentTargetRequiredSample).toBe(LOCAL);
    expect(dump.lastRequiredDecodeSample).toBe(HUMAN.lastRequired);
    expect(dump.maxReorderSamples).toBe(HUMAN.maxReorder);
    expect(dump.prefetch).toBe(HUMAN.prefetch);
    expect(dump.lookahead).toBe(6);
    expect(dump.decodeQueueSize).toBe(HUMAN.decodeQueue);
    expect(dump.softHighWater).toBe(HUMAN.high);
    expect(dump.hardDependencyCeiling).toBe(HARD);
    expect(dump.postRecreateSubmitted).toBe(HUMAN.lastSubmitted + 1);
    expect(dump.submittedMinusOutputs).toBe(dump.postRecreateSubmitted - dump.postRecreateOutputs);
    const text = formatStallMessage(dump);
    expect(text).toContain("requestedSample 43");
    expect(text).toContain("currentTargetRequiredSample 49");
    expect(text).toContain("softHighWater 12");
    expect(text).toContain("hardDependencyCeiling 21");
    decoder.close();
  }, 10_000);

  it("I. once LOCAL horizon is submitted, emergency credits stop; normal hysteresis resumes", async () => {
    const movie = loadMovie(LONG);
    expect(movie).not.toBeNull();
    restore = installControllableQueueDecoder();
    const decoder = new AfeVideoDecoder({ ...movie!, maxReorderSamples: HUMAN.maxReorder });
    await decoder.ensure();
    decoder.setPrefetchHint(HUMAN.prefetch);
    decoder.beginStream(new Uint8Array(movie!.sampleCount).fill(1), 0, {
      lastRequested: 90,
      lastRequiredDecodeSample: HUMAN.lastRequired,
      requestedIndexes: [HUMAN.sample],
    });
    decoder.openRequested(HUMAN.sample, decoder.chunkTimestampUs(movie!.samples[HUMAN.sample]!));
    decoder.setGopKeyframeStart(0);
    await decoder.recreate();
    decoder.setGopKeyframeStart(0);
    decoder.beginStream(new Uint8Array(movie!.sampleCount).fill(1), 0, {
      lastRequested: 90,
      lastRequiredDecodeSample: HUMAN.lastRequired,
      requestedIndexes: [HUMAN.sample],
      keepResolved: true,
    });
    decoder.restoreOpenedIdentity(HUMAN.sample, decoder.chunkTimestampUs(movie!.samples[HUMAN.sample]!));
    for (let i = 0; i <= LOCAL; i++) decoder.submitEncoded(movie!.samples[i]!);
    const mock = ControllableQueueDecoder.last!;
    mock.drain(mock.decodeQueueSize - HUMAN.high, false);
    expect(mock.decodeQueueSize).toBe(HUMAN.high);
    expect(decoder.snapshot().lastSubmittedSample).toBe(LOCAL);
    expect(decoder.currentTargetRequiredFor(HUMAN.sample)).toBe(LOCAL);
    const afterHorizon = await decoder.waitForDecodeCapacity(undefined, {
      requested: HUMAN.sample,
      budgetEnd: nowMs() + 40,
    });
    expect(afterHorizon).toBe(false);
    expect(
      mayBorrowHardDependencyCredits({
        ...REGRESSION,
        lastSubmittedSample: LOCAL,
        currentTargetRequiredSample: LOCAL,
      }),
    ).toBe(false);
    expect(decoder.decodeQueueHighWater).toBe(HUMAN.high);
    decoder.close();
  }, 10_000);

  it("J. HARD reached + no output progress → noMoreSubmission; queue does not keep growing", async () => {
    const movie = loadMovie(LONG);
    expect(movie).not.toBeNull();
    restore = installControllableQueueDecoder();
    const decoder = new AfeVideoDecoder({ ...movie!, maxReorderSamples: HUMAN.maxReorder });
    await decoder.ensure();
    decoder.setPrefetchHint(HUMAN.prefetch);
    decoder.beginStream(new Uint8Array(movie!.sampleCount).fill(1), 0, {
      lastRequested: 90,
      lastRequiredDecodeSample: HUMAN.lastRequired,
      requestedIndexes: [HUMAN.sample],
    });
    decoder.openRequested(HUMAN.sample, decoder.chunkTimestampUs(movie!.samples[HUMAN.sample]!));
    decoder.setGopKeyframeStart(0);
    await decoder.recreate();
    decoder.setGopKeyframeStart(0);
    decoder.beginStream(new Uint8Array(movie!.sampleCount).fill(1), 0, {
      lastRequested: 90,
      lastRequiredDecodeSample: HUMAN.lastRequired,
      requestedIndexes: [HUMAN.sample],
      keepResolved: true,
    });
    decoder.restoreOpenedIdentity(HUMAN.sample, decoder.chunkTimestampUs(movie!.samples[HUMAN.sample]!));
    const hard = decoder.hardDependencyCeilingFor(HUMAN.sample);
    for (let i = 0; i < hard && i < movie!.sampleCount; i++) decoder.submitEncoded(movie!.samples[i]!);
    const mock = ControllableQueueDecoder.last!;
    if (mock.decodeQueueSize > hard) mock.drain(mock.decodeQueueSize - hard, false);
    expect(mock.decodeQueueSize).toBe(hard);
    const blocked = await decoder.waitForDecodeCapacity(undefined, {
      requested: HUMAN.sample,
      budgetEnd: nowMs() + 40,
    });
    expect(blocked).toBe(false);
    const dump = decoder.snapshot({ sourceSampleRequested: HUMAN.sample });
    expect(dump.noMoreSubmission || dump.backpressureBlocked || dump.frozenAtHighWater).toBe(true);
    expect(dump.decodeQueueSize).toBeLessThanOrEqual(hard);
    expect(dump.decodeQueuePeak).toBeLessThanOrEqual(hard);
    expect(dump.decodeQueuePeak).toBeLessThan(40);
    expect(dump.decodeQueuePeak).toBeLessThan(125);
    expect(dump.decoderFlushCount).toBe(0);
    decoder.close();
  }, 10_000);

  it("K. first-fill SOFT HIGH / timeout unchanged; HARD may exceed SOFT when target is unsubmitted", async () => {
    expect(decodeQueueHighWater(HUMAN.maxReorder, HUMAN.prefetch)).toBeGreaterThanOrEqual(
      AFE_DECODE_QUEUE_RECOVERY_FILL,
    );
    expect(AFE_DECODE_STALL_MS).toBe(3000);
    const movie = loadMovie(LONG);
    expect(movie).not.toBeNull();
    restore = installControllableQueueDecoder();
    const decoder = new AfeVideoDecoder({ ...movie!, maxReorderSamples: HUMAN.maxReorder });
    await decoder.ensure();
    decoder.setPrefetchHint(HUMAN.prefetch);
    decoder.beginStream(new Uint8Array(movie!.sampleCount).fill(1), 0, {
      lastRequested: 90,
      lastRequiredDecodeSample: HUMAN.lastRequired,
      requestedIndexes: [HUMAN.sample],
    });
    decoder.openRequested(HUMAN.sample, decoder.chunkTimestampUs(movie!.samples[HUMAN.sample]!));
    const high = decoder.decodeQueueHighWater;
    expect(high).toBeGreaterThanOrEqual(40);
    for (let i = 0; i < high; i++) decoder.submitEncoded(movie!.samples[i]!);
    const hard = decoder.hardDependencyCeilingFor(HUMAN.sample);
    expect(hard).toBeGreaterThan(high);
    expect(hard).toBeLessThanOrEqual(AFE_DECODE_QUEUE_HIGH_WATER_CAP);
    const can = await decoder.waitForDecodeCapacity(undefined, {
      requested: HUMAN.sample,
      budgetEnd: nowMs() + 40,
    });
    expect(can).toBe(false);
    expect(decoder.snapshot().decodeQueueSize).toBeLessThanOrEqual(hard);
    expect(decoder.decodeQueueHighWater).toBe(high);
    decoder.close();
  }, 10_000);

  it("L. AFE-16 unused SOFT credits still feed lastRequired when queue is 7>LOW 6", () => {
    expect(
      mustAdvanceTowardDependencyHorizon({
        lastSubmittedSample: 59,
        lastRequiredDecodeSample: 140,
        decodeQueueSize: 7,
        highWater: 12,
        exactReady: false,
        usefulInputRemains: true,
      }),
    ).toBe(true);
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
    expect(
      mayBorrowHardDependencyCredits({
        exactReady: false,
        usefulInputRemains: true,
        currentTargetRequiredSample: 80,
        lastSubmittedSample: 59,
        outputProgressed: false,
        decodeQueueSize: 7,
        softHighWater: 12,
        hardDependencyCeiling: 22,
        afterRecreate: true,
      }),
    ).toBe(false);
  });
});
