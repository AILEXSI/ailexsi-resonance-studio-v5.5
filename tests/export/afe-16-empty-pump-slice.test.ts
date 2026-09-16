import { existsSync, readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import {
  AfeVideoDecoder,
  decodeQueueHighWater,
  decodeQueueLowWater,
  formatStallMessage,
  hasFurtherUsefulInput,
  mayResumeDecode,
  maySubmitEncoded,
  mustAdvanceTowardDependencyHorizon,
  nowMs,
  parseIsoBmff,
  progressivePumpSliceEnd,
} from "../../src/core/frame-engine";
import {
  ControllableQueueDecoder,
  installControllableQueueDecoder,
} from "./afe-videodecoder-mock";

const LONG = "tests/fixtures/afe/afe-cfr-30-g60-8s.mp4";

/** Windows AFE-16 human stall — empty pump slice + LOW_WATER starvation. */
const HUMAN = {
  sample: 74,
  ptsUs: 3_125_000,
  lastDecodedTs: 2_000_000,
  lastSubmitted: 59,
  pumpSliceStart: 60,
  pumpSliceEnd: 65,
  decodeQueue: 7,
  low: 6,
  high: 12,
  maxReorder: 2,
  prefetch: 4,
};

function loadMovie(path: string) {
  if (!existsSync(path)) return null;
  return parseIsoBmff(new Uint8Array(readFileSync(path)));
}

const STARVE = {
  lastSubmittedSample: HUMAN.lastSubmitted,
  lastRequiredDecodeSample: 140,
  decodeQueueSize: HUMAN.decodeQueue,
  highWater: HUMAN.high,
  exactReady: false,
  usefulInputRemains: true,
};

describe("AFE-16 A–J empty pump slice + LOW_WATER starvation", () => {
  let restore: (() => void) | undefined;
  afterEach(() => {
    restore?.();
    restore = undefined;
  });

  it("A. human stall: requested 74 PTS 3125000, submitted 59, pumpSlice 60-65, empty 60-59/paused", () => {
    const text = formatStallMessage({
      sourceSampleRequested: HUMAN.sample,
      requestedPtsUs: HUMAN.ptsUs,
      lastSubmittedSample: HUMAN.lastSubmitted,
      lastDecodedTimestamp: HUMAN.lastDecodedTs,
      decodeQueueSize: HUMAN.decodeQueue,
      decodeQueueLowWater: HUMAN.low,
      decodeQueueHighWater: HUMAN.high,
      pumpSliceStart: HUMAN.pumpSliceStart,
      pumpSliceEnd: HUMAN.pumpSliceEnd,
      backpressureBlocked: true,
      noMoreSubmission: true,
      stallPhase: "PUMP_LOOKAHEAD",
      submitPhaseTraces: [
        {
          phase: "PUMP_LOOKAHEAD",
          submittedFrom: 60,
          submittedTo: 59,
          decodeQueueStart: 7,
          decodeQueueEnd: 7,
          lastDecodedStart: HUMAN.lastDecodedTs,
          lastDecodedEnd: HUMAN.lastDecodedTs,
          pausedForCapacity: true,
          outputProgressed: false,
        },
      ],
    });
    expect(text).toContain("requested sample 74 PTS 3125000");
    expect(text).toContain("lastSubmittedSample 59 (sample-index)");
    expect(text).toContain("lastDecodedTs 2000000");
    expect(text).toContain("decodeQueue 7");
    expect(text).toContain("pumpSlice 60-65");
    expect(text).toContain("backpressureBlocked yes");
    expect(text).toContain("noMoreSubmission yes");
    expect(text).toContain("PUMP_LOOKAHEAD:60-59/q7->7/ts2000000->2000000/paused");
  });

  it("B. root cause: intended slice 60-65; beginSubmitPhase(60)+no submit → trace 60-59", () => {
    expect(
      progressivePumpSliceEnd({
        nextDecode: 60,
        lastRequiredDecodeSample: 90,
        sampleCount: 240,
        sliceSamples: 6,
      }),
    ).toBe(65);
    expect(HUMAN.pumpSliceStart).toBe(HUMAN.lastSubmitted + 1);
    expect(HUMAN.pumpSliceEnd).toBe(HUMAN.lastSubmitted + 6);
    // submittedFrom = nextDecode (60); submittedTo stays lastSubmitted (59)
    // because waitForDecodeCapacity refused before any decode().
    const submittedFrom = HUMAN.lastSubmitted + 1;
    const submittedTo = HUMAN.lastSubmitted;
    expect(`${submittedFrom}-${submittedTo}`).toBe("60-59");
    expect(submittedFrom).toBeGreaterThan(submittedTo);
  });

  it("C. PUMP_LOOKAHEAD:60-59 condition is LOW_WATER hysteresis while paused, queue 7>6, not HIGH", () => {
    expect(
      maySubmitEncoded({
        decodeQueueSize: HUMAN.decodeQueue,
        highWater: HUMAN.high,
        outputProgressed: false,
        lowWater: HUMAN.low,
        paused: true,
        exactReady: false,
      }),
    ).toBe(false);
    expect(
      mayResumeDecode({
        decodeQueueSize: HUMAN.decodeQueue,
        highWater: HUMAN.high,
        lowWater: HUMAN.low,
        exactReady: false,
        paused: true,
      }),
    ).toBe(false);
    expect(HUMAN.decodeQueue).toBeGreaterThan(HUMAN.low);
    expect(HUMAN.decodeQueue).toBeLessThan(HUMAN.high);
    expect(HUMAN.high - HUMAN.decodeQueue).toBe(5);
  });

  it("D. CAPACITY INVARIANT: lastSubmitted<lastRequired, useful input, queue<HIGH, not exact → must advance", () => {
    expect(mustAdvanceTowardDependencyHorizon(STARVE)).toBe(true);
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
    ).toBe(true);
    expect(
      mayResumeDecode({
        decodeQueueSize: HUMAN.decodeQueue,
        highWater: HUMAN.high,
        lowWater: HUMAN.low,
        exactReady: false,
        paused: true,
        mustAdvanceTowardDependencyHorizon: true,
      }),
    ).toBe(true);
  });

  it("E. HIGH_WATER still blocks; override off only after lastRequired is fully submitted", () => {
    expect(
      mustAdvanceTowardDependencyHorizon({
        ...STARVE,
        decodeQueueSize: HUMAN.high,
      }),
    ).toBe(false);
    expect(
      maySubmitEncoded({
        decodeQueueSize: HUMAN.high,
        highWater: HUMAN.high,
        outputProgressed: false,
        lowWater: HUMAN.low,
        paused: true,
        mustAdvanceTowardDependencyHorizon: true,
      }),
    ).toBe(false);
    expect(
      mayResumeDecode({
        decodeQueueSize: HUMAN.decodeQueue,
        highWater: HUMAN.high,
        lowWater: HUMAN.low,
        exactReady: false,
        paused: true,
        mustAdvanceTowardDependencyHorizon: false,
      }),
    ).toBe(false);
    expect(
      mustAdvanceTowardDependencyHorizon({
        ...STARVE,
        exactReady: true,
      }),
    ).toBe(false);
    expect(
      mustAdvanceTowardDependencyHorizon({
        ...STARVE,
        usefulInputRemains: false,
      }),
    ).toBe(false);
    expect(
      hasFurtherUsefulInput({
        nextDecode: 60,
        sampleCount: 240,
        lastRequiredDecodeSample: 90,
      }),
    ).toBe(true);
  });

  it("F. post-recreate HIGH 12 LOW 6 matches human credits (reorder 2 / prefetch 4)", () => {
    const high = decodeQueueHighWater(HUMAN.maxReorder, HUMAN.prefetch, { afterRecreate: true });
    const low = decodeQueueLowWater(HUMAN.maxReorder, HUMAN.prefetch, { afterRecreate: true });
    expect(high).toBe(HUMAN.high);
    expect(low).toBe(HUMAN.low);
    expect(HUMAN.high - HUMAN.decodeQueue).toBe(5);
  });

  it("G. waitForDecodeCapacity must not refuse at queue 7>LOW 6 when requested 74>submitted 59", async () => {
    const movie = loadMovie(LONG);
    expect(movie).not.toBeNull();
    restore = installControllableQueueDecoder();
    const decoder = new AfeVideoDecoder({ ...movie!, maxReorderSamples: HUMAN.maxReorder });
    await decoder.ensure();
    decoder.setPrefetchHint(HUMAN.prefetch);
    decoder.beginStream(new Uint8Array(movie!.sampleCount).fill(1), 0, {
      lastRequested: 80,
      lastRequiredDecodeSample: 90,
      requestedIndexes: [HUMAN.sample],
    });
    decoder.openRequested(HUMAN.sample, decoder.chunkTimestampUs(movie!.samples[HUMAN.sample]!));
    decoder.setGopKeyframeStart(0);
    await decoder.recreate();
    decoder.setGopKeyframeStart(0);
    decoder.beginStream(new Uint8Array(movie!.sampleCount).fill(1), 0, {
      lastRequested: 80,
      lastRequiredDecodeSample: 90,
      requestedIndexes: [HUMAN.sample],
      keepResolved: true,
    });
    decoder.restoreOpenedIdentity(HUMAN.sample, decoder.chunkTimestampUs(movie!.samples[HUMAN.sample]!));
    expect(decoder.decodeQueueHighWater).toBe(HUMAN.high);
    expect(decoder.decodeQueueLowWater).toBe(HUMAN.low);
    for (let i = 0; i <= HUMAN.lastSubmitted; i++) decoder.submitEncoded(movie!.samples[i]!);
    const mock = ControllableQueueDecoder.last!;
    expect(mock.decodeQueueSize).toBe(HUMAN.lastSubmitted + 1);
    mock.drain(mock.decodeQueueSize - HUMAN.high, false);
    expect(mock.decodeQueueSize).toBe(HUMAN.high);
    const atHigh = await decoder.waitForDecodeCapacity(undefined, {
      requested: HUMAN.sample,
      budgetEnd: nowMs() + 40,
    });
    /* AFE-17: SOFT HIGH is not a permanent stop while the local target is still unsubmitted. */
    expect(atHigh).toBe(true);
    mock.drain(HUMAN.high - HUMAN.decodeQueue, false);
    expect(mock.decodeQueueSize).toBe(HUMAN.decodeQueue);
    expect(mock.decodeQueueSize).toBeGreaterThan(decoder.decodeQueueLowWater);
    expect(mock.decodeQueueSize).toBeLessThan(decoder.decodeQueueHighWater);
    const dumpBefore = decoder.snapshot();
    expect(dumpBefore.lastSubmittedSample).toBe(HUMAN.lastSubmitted);
    decoder.beginSubmitPhase("PUMP_LOOKAHEAD", HUMAN.lastSubmitted + 1);
    const can = await decoder.waitForDecodeCapacity(undefined, {
      requested: HUMAN.sample,
      budgetEnd: nowMs() + 40,
    });
    expect(can).toBe(true);
    decoder.submitEncoded(movie!.samples[60]!);
    decoder.endSubmitPhase();
    const dump = decoder.snapshot();
    expect(dump.lastSubmittedSample).toBe(60);
    expect(dump.decodeQueueSize).toBe(HUMAN.decodeQueue + 1);
    const empty = dump.submitPhaseTraces.find(
      (t) => t.submittedFrom === 60 && t.submittedTo === 59,
    );
    expect(empty).toBeUndefined();
    expect(dump.decodeQueueSize).toBeLessThanOrEqual(HUMAN.high);
    decoder.close();
  }, 10_000);

  it("H. pump toward requested PTS while queue stays >LOW and <HIGH; no unbounded growth; no output progress", async () => {
    const movie = loadMovie(LONG);
    expect(movie).not.toBeNull();
    restore = installControllableQueueDecoder();
    const decoder = new AfeVideoDecoder({ ...movie!, maxReorderSamples: HUMAN.maxReorder });
    await decoder.ensure();
    decoder.setPrefetchHint(HUMAN.prefetch);
    decoder.beginStream(new Uint8Array(movie!.sampleCount).fill(1), 0, {
      lastRequested: 80,
      lastRequiredDecodeSample: 90,
      requestedIndexes: [HUMAN.sample],
    });
    decoder.openRequested(HUMAN.sample, decoder.chunkTimestampUs(movie!.samples[HUMAN.sample]!));
    decoder.setGopKeyframeStart(0);
    await decoder.recreate();
    decoder.setGopKeyframeStart(0);
    decoder.beginStream(new Uint8Array(movie!.sampleCount).fill(1), 0, {
      lastRequested: 80,
      lastRequiredDecodeSample: 90,
      requestedIndexes: [HUMAN.sample],
      keepResolved: true,
    });
    decoder.restoreOpenedIdentity(HUMAN.sample, decoder.chunkTimestampUs(movie!.samples[HUMAN.sample]!));
    const high = decoder.decodeQueueHighWater;
    const low = decoder.decodeQueueLowWater;
    for (let i = 0; i <= HUMAN.lastSubmitted; i++) decoder.submitEncoded(movie!.samples[i]!);
    const mock = ControllableQueueDecoder.last!;
    mock.drain(mock.decodeQueueSize - high, false);
    await decoder.waitForDecodeCapacity(undefined, {
      requested: HUMAN.sample,
      budgetEnd: nowMs() + 40,
    });
    mock.drain(high - HUMAN.decodeQueue, false);
    expect(mock.decodeQueueSize).toBe(HUMAN.decodeQueue);
    const lastDecodedAtStart = decoder.snapshot().lastDecodedTimestamp;
    let next = HUMAN.lastSubmitted + 1;
    let peak = mock.decodeQueueSize;
    decoder.setPumpSlice(60, 65);
    const lastRequired = 90;
    while (next <= lastRequired) {
      if (mock.decodeQueueSize >= high) {
        mock.drain(1, false);
        expect(mock.decodeQueueSize).toBeGreaterThan(low);
        expect(mock.decodeQueueSize).toBeLessThan(high);
      }
      const can = await decoder.waitForDecodeCapacity(undefined, {
        requested: HUMAN.sample,
        budgetEnd: nowMs() + 40,
      });
      if (!can) break;
      decoder.submitEncoded(movie!.samples[next]!);
      next += 1;
      peak = Math.max(peak, mock.decodeQueueSize);
      expect(mock.decodeQueueSize).toBeLessThanOrEqual(high);
    }
    expect(next - 1).toBeGreaterThanOrEqual(lastRequired);
    expect(decoder.snapshot().lastSubmittedSample).toBeGreaterThanOrEqual(lastRequired);
    expect(peak).toBeLessThanOrEqual(high);
    expect(peak).toBeLessThan(40);
    expect(peak).toBeLessThan(125);
    expect(decoder.snapshot().lastDecodedTimestamp).toBe(lastDecodedAtStart);
    expect(decoder.snapshot().decoderFlushCount).toBe(0);
    decoder.close();
  }, 10_000);

  it("I. first-fill: same invariant — unused HIGH credits must feed lastRequired horizon", async () => {
    const movie = loadMovie(LONG);
    expect(movie).not.toBeNull();
    restore = installControllableQueueDecoder();
    const decoder = new AfeVideoDecoder({ ...movie!, maxReorderSamples: HUMAN.maxReorder });
    await decoder.ensure();
    decoder.setPrefetchHint(HUMAN.prefetch);
    decoder.beginStream(new Uint8Array(movie!.sampleCount).fill(1), 0, {
      lastRequested: 80,
      lastRequiredDecodeSample: 90,
      requestedIndexes: [HUMAN.sample],
    });
    decoder.openRequested(HUMAN.sample, decoder.chunkTimestampUs(movie!.samples[HUMAN.sample]!));
    const high = decoder.decodeQueueHighWater;
    expect(high).toBeGreaterThanOrEqual(40);
    for (let i = 0; i < high; i++) decoder.submitEncoded(movie!.samples[i]!);
    const mock = ControllableQueueDecoder.last!;
    const blocked = await decoder.waitForDecodeCapacity(undefined, {
      requested: HUMAN.sample,
      budgetEnd: nowMs() + 40,
    });
    expect(blocked).toBe(false);
    mock.drain(high - HUMAN.decodeQueue, false);
    expect(mock.decodeQueueSize).toBe(HUMAN.decodeQueue);
    const lastSubmitted = decoder.snapshot().lastSubmittedSample ?? -1;
    expect(HUMAN.sample).toBeGreaterThan(lastSubmitted);
    const can = await decoder.waitForDecodeCapacity(undefined, {
      requested: HUMAN.sample,
      budgetEnd: nowMs() + 40,
    });
    expect(can).toBe(true);
    decoder.submitEncoded(movie!.samples[lastSubmitted + 1]!);
    expect(decoder.snapshot().lastSubmittedSample).toBe(lastSubmitted + 1);
    expect(decoder.snapshot().decodeQueueSize).toBeLessThanOrEqual(high);
    decoder.close();
  }, 10_000);

  it("J. lastSubmitted==requested still advances while lastSubmitted<lastRequired; hysteresis only after lastRequired", async () => {
    expect(
      mustAdvanceTowardDependencyHorizon({
        lastSubmittedSample: 74,
        lastRequiredDecodeSample: 140,
        decodeQueueSize: HUMAN.decodeQueue,
        highWater: HUMAN.high,
        exactReady: false,
        usefulInputRemains: true,
      }),
    ).toBe(true);
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
    ).toBe(true);

    expect(
      mustAdvanceTowardDependencyHorizon({
        lastSubmittedSample: 140,
        lastRequiredDecodeSample: 140,
        decodeQueueSize: HUMAN.decodeQueue,
        highWater: HUMAN.high,
        exactReady: false,
        usefulInputRemains: true,
      }),
    ).toBe(false);
    expect(
      mayResumeDecode({
        decodeQueueSize: HUMAN.decodeQueue,
        highWater: HUMAN.high,
        lowWater: HUMAN.low,
        exactReady: false,
        paused: true,
        mustAdvanceTowardDependencyHorizon: false,
      }),
    ).toBe(false);

    const movie = loadMovie(LONG);
    expect(movie).not.toBeNull();
    restore = installControllableQueueDecoder();
    const decoder = new AfeVideoDecoder({ ...movie!, maxReorderSamples: HUMAN.maxReorder });
    await decoder.ensure();
    decoder.setPrefetchHint(HUMAN.prefetch);
    decoder.beginStream(new Uint8Array(movie!.sampleCount).fill(1), 0, {
      lastRequested: HUMAN.sample,
      lastRequiredDecodeSample: 140,
      requestedIndexes: [HUMAN.sample],
    });
    decoder.openRequested(HUMAN.sample, decoder.chunkTimestampUs(movie!.samples[HUMAN.sample]!));
    decoder.setGopKeyframeStart(0);
    await decoder.recreate();
    decoder.setGopKeyframeStart(0);
    decoder.beginStream(new Uint8Array(movie!.sampleCount).fill(1), 0, {
      lastRequested: HUMAN.sample,
      lastRequiredDecodeSample: 140,
      requestedIndexes: [HUMAN.sample],
      keepResolved: true,
    });
    decoder.restoreOpenedIdentity(HUMAN.sample, decoder.chunkTimestampUs(movie!.samples[HUMAN.sample]!));
    const high = decoder.decodeQueueHighWater;
    const low = decoder.decodeQueueLowWater;
    for (let i = 0; i <= HUMAN.sample; i++) decoder.submitEncoded(movie!.samples[i]!);
    const mock = ControllableQueueDecoder.last!;
    if (mock.decodeQueueSize > HUMAN.decodeQueue) mock.drain(mock.decodeQueueSize - HUMAN.decodeQueue, false);
    expect(mock.decodeQueueSize).toBe(HUMAN.decodeQueue);
    expect(decoder.snapshot().lastSubmittedSample).toBe(HUMAN.sample);
    const stillNeedDeps = await decoder.waitForDecodeCapacity(undefined, {
      requested: HUMAN.sample,
      budgetEnd: nowMs() + 40,
    });
    expect(stillNeedDeps).toBe(true);
    decoder.submitEncoded(movie!.samples[HUMAN.sample + 1]!);
    expect(decoder.snapshot().lastSubmittedSample).toBe(HUMAN.sample + 1);

    for (let i = HUMAN.sample + 2; i <= 140; i++) decoder.submitEncoded(movie!.samples[i]!);
    mock.drain(mock.decodeQueueSize - high, false);
    const atHigh = await decoder.waitForDecodeCapacity(undefined, {
      requested: HUMAN.sample,
      budgetEnd: nowMs() + 40,
    });
    expect(atHigh).toBe(false);
    mock.drain(high - HUMAN.decodeQueue, false);
    expect(mock.decodeQueueSize).toBe(HUMAN.decodeQueue);
    expect(decoder.snapshot().lastSubmittedSample).toBe(140);
    const afterHorizon = await decoder.waitForDecodeCapacity(undefined, {
      requested: HUMAN.sample,
      budgetEnd: nowMs() + 40,
    });
    expect(afterHorizon).toBe(false);
    expect(mock.decodeQueueSize).toBeGreaterThan(low);
    decoder.close();
  }, 10_000);
});
