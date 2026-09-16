import { existsSync, readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import {
  AFE_DECODE_QUEUE_HIGH_WATER_CAP,
  AFE_DECODE_QUEUE_RECOVERY_FILL,
  AFE_DECODE_WINDOW_LOOKAHEAD,
  AfeScheduler,
  AfeVideoDecoder,
  chunkFingerprintsEqual,
  comparePacketParity,
  decodeOrigin,
  decodeQueueHighWater,
  decodeQueueLowWater,
  decodeWindowBNeed,
  decodeWindowLookahead,
  earlierKeyframeOrigin,
  expectedRecoveryChunks,
  fingerprintMovieConfig,
  fingerprintSampleChunk,
  firstChunkAfterRecreateCheck,
  formatStallMessage,
  getAfeSequentialPrefetch,
  lastRequiredDecodeSample,
  mayEarlierKeyframeRecover,
  mayFinalFlush,
  mayResumeDecode,
  maySubmitEncoded,
  noMoreSubmissionRequired,
  nowMs,
  parseIsoBmff,
  recoveryMatchesColdPrefix,
  streamLookaheadSamples,
} from "../../src/core/frame-engine";
import { sequentialTimes } from "./afe-plan";
import {
  ControllableQueueDecoder,
  installControllableQueueDecoder,
  installHangFlushDecoder,
  installNeverEmitDecoder,
  installRecoverThenFreezeAtHighWaterDecoder,
} from "./afe-videodecoder-mock";

const LONG = "tests/fixtures/afe/afe-cfr-30-g60-8s.mp4";
const BFRAME = "tests/fixtures/afe/afe-bframe-30-g30-2s.mp4";

/** Latest Windows human 720p30 stall (AFE-13 EXE). */
const HUMAN = {
  sample: 34,
  ptsUs: 1_458_333,
  lastDecodedTs: 458_333,
  gopStart: 0,
  decodeQueuePeak: 40,
  submitted: 55,
  lastRequested: 68,
  lastRequired: 92,
  req: 42,
  dec: 41,
  enc: 41,
  unresolved: 1,
  maxReorder: 10,
  prefetch: 4,
  lookahead: 6,
};

function loadMovie(path: string) {
  if (!existsSync(path)) return null;
  return parseIsoBmff(new Uint8Array(readFileSync(path)));
}

function times(path: string, frames: number, fps: number, id: string) {
  return sequentialTimes({
    id,
    path,
    fps,
    frames,
    seconds: frames / fps,
    gop: 30,
    keyframeSec: [0],
  });
}

describe("AFE-14 A–N packet/config parity + bounded decode window", () => {
  let restore: (() => void) | undefined;
  afterEach(() => {
    restore?.();
    restore = undefined;
  });

  it("A. human stall: gopStart 0, no earlier I, lastDecoded 458333, HIGH held at 40", () => {
    expect(HUMAN.lastDecodedTs).toBe(458_333);
    expect(HUMAN.gopStart).toBe(0);
    const movie = loadMovie(LONG);
    if (movie) expect(earlierKeyframeOrigin(movie, 0)).toBeNull();
    expect(
      mayEarlierKeyframeRecover({
        frozenHighWaterAfterRecreate: true,
        earlierKeyframeOrigin: null,
        earlierKeyframeRecovered: false,
        gopKeyframeStart: 0,
        earlierKeyframeAvailable: false,
      }),
    ).toBe(false);
    const text = formatStallMessage({
      sourceSampleRequested: HUMAN.sample,
      requestedPtsUs: HUMAN.ptsUs,
      originRequestedSample: HUMAN.sample,
      originRequestedPts: HUMAN.ptsUs,
      lastSubmittedSample: HUMAN.submitted,
      lastRequestedSample: HUMAN.lastRequested,
      lastRequiredDecodeSample: HUMAN.lastRequired,
      lastDecodedTimestamp: HUMAN.lastDecodedTs,
      decodeQueuePeak: HUMAN.decodeQueuePeak,
      decodeQueueSize: 40,
      decodeQueueHighWater: 40,
      gopKeyframeStart: 0,
      decodeStartSample: 0,
      frozenAtHighWater: true,
      earlierKeyframeRecovered: false,
      earlierKeyframeAvailable: false,
      firstSubmittedAfterRecreate: 0,
      firstSubmittedAfterRecreateKey: true,
      packetParity: true,
      configParity: true,
      unresolvedRequestedVideoFrames: HUMAN.unresolved,
      videoFramesRequested: HUMAN.req,
      videoFramesDecoded: HUMAN.dec,
      videoFramesEncoded: HUMAN.enc,
      ownershipRebuilt: true,
      finalFlushAttempted: false,
      finalFlushArmed: false,
    });
    expect(text).toContain("requested sample 34 PTS 1458333");
    expect(text).toContain("gopStart 0");
    expect(text).toContain("decodeStart 0");
    expect(text).toContain("lastDecodedTs 458333");
    expect(text).toContain("frozenAtHighWater yes");
    expect(text).toContain("earlierKeyframeRecovered no");
    expect(text).toContain("earlierKeyframeAvailable no");
    expect(text).toContain("decodeQueuePeak 40");
    expect(text).toContain("submitted 55");
    expect(text).toContain("unresolvedRequested 1");
    expect(text).toContain("FINAL_FLUSH no");
    expect(text).toContain("ownershipRebuilt yes");
    expect(text).toContain("packetParity yes");
    expect(text).toContain("configParity yes");
    expect(text).toContain("firstSubmittedAfterRecreate 0");
    expect(458_333 / 41_666.67).toBeCloseTo(11, 0);
  });

  it("B. chunk fingerprint is compact: index/PTS/DTS/duration/key/payload/config — no raw dump", () => {
    const movie = loadMovie(LONG);
    expect(movie).not.toBeNull();
    const cfg = fingerprintMovieConfig(movie!);
    expect(cfg.hash).toMatch(/^[0-9a-f]{8}$/);
    expect(cfg.descriptionHash).toMatch(/^[0-9a-f]{8}$/);
    expect(cfg.optimizeForLatency).toBe(false);
    const fp = fingerprintSampleChunk(movie!, movie!.samples[0]!, cfg.hash);
    expect(fp.index).toBe(0);
    expect(fp.key).toBe(true);
    expect(Number.isInteger(fp.ptsUs)).toBe(true);
    expect(Number.isInteger(fp.dtsUs)).toBe(true);
    expect(fp.durationUs).toBeGreaterThan(0);
    expect(fp.payloadHash).toMatch(/^[0-9a-f]{8}$/);
    expect(fp.configHash).toBe(cfg.hash);
    const json = JSON.stringify(fp);
    expect(json).not.toMatch(/nal|avcC|annex/i);
    expect(json.length).toBeLessThan(240);
  });

  it("C. PARITY INVARIANT: ColdStartChunk(N) == RecoveryChunk(N)", async () => {
    const movie = loadMovie(LONG);
    expect(movie).not.toBeNull();
    restore = installNeverEmitDecoder();
    const cold = new AfeVideoDecoder(movie!);
    await cold.ensure();
    cold.setGopKeyframeStart(0);
    cold.beginStream(new Uint8Array(movie!.sampleCount).fill(1), 0, {
      lastRequested: 20,
      lastRequiredDecodeSample: 24,
      requestedIndexes: [8],
    });
    for (let i = 0; i < 16; i++) cold.submitEncoded(movie!.samples[i]!);

    const recovery = new AfeVideoDecoder(movie!);
    await recovery.ensure();
    recovery.beginStream(new Uint8Array(movie!.sampleCount).fill(1), 0, {
      lastRequested: 20,
      lastRequiredDecodeSample: 24,
      requestedIndexes: [8],
    });
    for (let i = 0; i < 4; i++) recovery.submitEncoded(movie!.samples[i]!);
    recovery.setGopKeyframeStart(0);
    await recovery.recreate();
    recovery.setGopKeyframeStart(0);
    recovery.beginStream(new Uint8Array(movie!.sampleCount).fill(1), 0, {
      lastRequested: 20,
      lastRequiredDecodeSample: 24,
      requestedIndexes: [8],
      keepResolved: true,
    });
    for (let i = 0; i < 16; i++) recovery.submitEncoded(movie!.samples[i]!);

    const prefix = recoveryMatchesColdPrefix(cold.coldStartChunks, recovery.recoveryStartChunks);
    expect(prefix.equal).toBe(true);
    expect(prefix.compared).toBe(16);
    expect(prefix.mismatchIndex).toBeNull();
    for (let n = 0; n < 16; n++) {
      expect(chunkFingerprintsEqual(cold.coldStartChunks[n]!, recovery.recoveryStartChunks[n]!)).toBe(true);
    }
    const dump = recovery.snapshot();
    expect(dump.packetParity).toBe(true);
    expect(dump.configParity).toBe(true);
    expect(dump.firstSubmittedAfterRecreate).toBe(0);
    expect(dump.firstSubmittedAfterRecreateKey).toBe(true);
    expect(dump.gopKeyframeStart).toBe(0);
    const full = comparePacketParity(cold.coldStartChunks, recovery.recoveryStartChunks);
    expect(full.equal).toBe(true);
    cold.close();
    recovery.close();
  }, 10_000);

  it("D. FIRST-CHUNK AFTER RECREATE: gopStart 0, sample 0 keyframe, expected PTS/DTS", async () => {
    const movie = loadMovie(LONG);
    expect(movie).not.toBeNull();
    const sample0 = movie!.samples[0]!;
    expect(sample0.isKeyframe).toBe(true);
    const cfg = fingerprintMovieConfig(movie!);
    const expected = fingerprintSampleChunk(movie!, sample0, cfg.hash);
    const ok = firstChunkAfterRecreateCheck(movie!, 0, expected);
    expect(ok.ok).toBe(true);
    expect(ok.gopStart).toBe(0);
    expect(ok.sampleIndex).toBe(0);
    expect(ok.key).toBe(true);
    expect(ok.ptsUs).toBe(expected.ptsUs);
    expect(ok.dtsUs).toBe(expected.dtsUs);

    restore = installNeverEmitDecoder();
    const decoder = new AfeVideoDecoder(movie!);
    await decoder.ensure();
    decoder.setGopKeyframeStart(0);
    decoder.beginStream(new Uint8Array(movie!.sampleCount).fill(1), 0, {
      lastRequested: 8,
      lastRequiredDecodeSample: 12,
      requestedIndexes: [3],
    });
    decoder.submitEncoded(movie!.samples[0]!);
    await decoder.recreate();
    decoder.setGopKeyframeStart(0);
    decoder.beginStream(new Uint8Array(movie!.sampleCount).fill(1), 0, {
      lastRequested: 8,
      lastRequiredDecodeSample: 12,
      requestedIndexes: [3],
      keepResolved: true,
    });
    expect(() => decoder.submitEncoded(movie!.samples[1]!)).toThrow(/first chunk after recreate/i);
    decoder.close();

    const decoder2 = new AfeVideoDecoder(movie!);
    await decoder2.ensure();
    decoder2.setGopKeyframeStart(0);
    await decoder2.recreate();
    decoder2.setGopKeyframeStart(0);
    decoder2.beginStream(new Uint8Array(movie!.sampleCount).fill(1), 0, {
      lastRequested: 8,
      lastRequiredDecodeSample: 12,
      requestedIndexes: [3],
      keepResolved: true,
    });
    decoder2.submitEncoded(movie!.samples[0]!);
    const dump = decoder2.snapshot();
    expect(dump.firstSubmittedAfterRecreate).toBe(0);
    expect(dump.firstSubmittedAfterRecreateKey).toBe(true);
    expect(dump.firstSubmittedAfterRecreatePts).toBe(expected.ptsUs);
    expect(dump.firstSubmittedAfterRecreateDts).toBe(expected.dtsUs);
    expect(dump.gopKeyframeStart).toBe(0);
    decoder2.close();
  }, 10_000);

  it("E. config parity: same codec/size/description/optimizeForLatency hash after recreate", async () => {
    const movie = loadMovie(LONG);
    expect(movie).not.toBeNull();
    restore = installNeverEmitDecoder();
    const decoder = new AfeVideoDecoder(movie!);
    await decoder.ensure();
    const coldHash = decoder.lastDecoderConfigFingerprint?.hash;
    expect(coldHash).toMatch(/^[0-9a-f]{8}$/);
    expect(decoder.lastDecoderConfigFingerprint?.optimizeForLatency).toBe(false);
    decoder.setGopKeyframeStart(0);
    await decoder.recreate();
    decoder.setGopKeyframeStart(0);
    expect(decoder.lastDecoderConfigFingerprint?.hash).toBe(coldHash);
    const dump = decoder.snapshot();
    expect(dump.configParity).toBe(true);
    expect(dump.configParityHashCold).toBe(coldHash);
    expect(dump.configParityHashRecovery).toBe(coldHash);
    decoder.close();
  }, 10_000);

  it("F. post-recreate output liveness trace aggregates", async () => {
    const movie = loadMovie(LONG);
    expect(movie).not.toBeNull();
    restore = installRecoverThenFreezeAtHighWaterDecoder({
      emitBeforeFreeze: 4,
      emitOnInstance: 99,
    });
    const decoder = new AfeVideoDecoder(movie!);
    await decoder.ensure();
    decoder.setGopKeyframeStart(0);
    decoder.beginStream(new Uint8Array(movie!.sampleCount).fill(1), 0, {
      lastRequested: 20,
      lastRequiredDecodeSample: 24,
      requestedIndexes: [8],
    });
    decoder.openRequested(8, decoder.chunkTimestampUs(movie!.samples[8]!));
    for (let i = 0; i < 6; i++) decoder.submitEncoded(movie!.samples[i]!);
    await decoder.recreate();
    decoder.setGopKeyframeStart(0);
    decoder.beginStream(new Uint8Array(movie!.sampleCount).fill(1), 0, {
      lastRequested: 20,
      lastRequiredDecodeSample: 24,
      requestedIndexes: [8],
      keepResolved: true,
    });
    decoder.restoreOpenedIdentity(8, decoder.chunkTimestampUs(movie!.samples[8]!));
    for (let i = 0; i < 8; i++) decoder.submitEncoded(movie!.samples[i]!);
    await new Promise((r) => setTimeout(r, 20));
    const dump = decoder.snapshot();
    expect(dump.postRecreateSubmitted).toBe(8);
    expect(dump.postRecreateOutputs).toBeGreaterThan(0);
    expect(dump.postRecreateOutputTimestamps.length).toBe(dump.postRecreateOutputs);
    expect(dump.postRecreateLastDecodedTs).not.toBeNull();
    expect(dump.packetParity).toBe(true);
    expect(dump.configParity).toBe(true);
    decoder.close();
  }, 10_000);

  it("G. stall dump answers A vs B: correct stream then stop, or different feed?", () => {
    const same = formatStallMessage({
      sourceSampleRequested: 34,
      requestedPtsUs: 1_458_333,
      lastDecodedTimestamp: 458_333,
      gopKeyframeStart: 0,
      firstSubmittedAfterRecreate: 0,
      firstSubmittedAfterRecreateKey: true,
      packetParity: true,
      configParity: true,
      postRecreateSubmitted: 20,
      postRecreateOutputs: 11,
      postRecreateLastDecodedTs: 458_333,
      postRecreateOutputTimestamps: [0, 41_667, 83_333, 458_333],
      frozenAtHighWater: true,
      earlierKeyframeAvailable: false,
    });
    expect(same).toContain("packetParity yes");
    expect(same).toContain("configParity yes");
    expect(same).toContain("firstSubmittedAfterRecreate 0");
    expect(same).toContain("postRecreateLastDecodedTs 458333");
    expect(same).toContain("postRecreateOutputs 11");
    expect(same).toMatch(/packetParity yes.*configParity yes|configParity yes.*packetParity yes/);

    const different = formatStallMessage({
      packetParity: false,
      packetParityMismatchIndex: 3,
      packetParityMismatchField: "ptsUs",
      configParity: false,
      firstSubmittedAfterRecreate: 2,
      firstSubmittedAfterRecreateKey: false,
    });
    expect(different).toContain("packetParity no");
    expect(different).toContain("packetParityMismatch 3:ptsUs");
    expect(different).toContain("configParity no");
    expect(different).toContain("firstSubmittedAfterRecreate 2");
    expect(different).toContain("firstSubmittedAfterRecreateKey no");
  });

  it("H. mismatch is typed failure — HIGH_WATER is not lowered to hide it", () => {
    const movie = loadMovie(LONG);
    expect(movie).not.toBeNull();
    const cfg = fingerprintMovieConfig(movie!);
    const cold = expectedRecoveryChunks(movie!, 0, 4, cfg.hash);
    const rec = expectedRecoveryChunks(movie!, 0, 4, cfg.hash).map((c, i) =>
      i === 2 ? { ...c, ptsUs: c.ptsUs + 1 } : c,
    );
    const result = comparePacketParity(cold, rec);
    expect(result.equal).toBe(false);
    expect(result.mismatchIndex).toBe(2);
    expect(result.field).toBe("ptsUs");
    expect(decodeQueueHighWater(HUMAN.maxReorder, HUMAN.prefetch, { afterRecreate: true })).toBeLessThan(40);
    expect(AFE_DECODE_QUEUE_RECOVERY_FILL).toBe(40);
    expect(firstChunkAfterRecreateCheck(movie!, 0, { index: 1, key: false, ptsUs: 0, dtsUs: 0 }).ok).toBe(
      false,
    );
  });

  it("I. HIGH_WATER < 40 for human shape (reorder10 prefetch4 lookahead6); LOW < HIGH", async () => {
    expect(AFE_DECODE_WINDOW_LOOKAHEAD).toBe(6);
    expect(HUMAN.lookahead).toBe(6);
    expect(getAfeSequentialPrefetch()).toBe(4);
    const L = decodeWindowLookahead(HUMAN.maxReorder, HUMAN.prefetch);
    const B = decodeWindowBNeed(HUMAN.prefetch);
    expect(L).toBe(6);
    expect(B).toBe(4);
    const highFirst = decodeQueueHighWater(HUMAN.maxReorder, HUMAN.prefetch);
    const high = decodeQueueHighWater(HUMAN.maxReorder, HUMAN.prefetch, { afterRecreate: true });
    const low = decodeQueueLowWater(HUMAN.maxReorder, HUMAN.prefetch, { afterRecreate: true });
    expect(highFirst).toBe(AFE_DECODE_QUEUE_RECOVERY_FILL);
    expect(high).toBe(HUMAN.maxReorder + L + B);
    expect(high).toBe(20);
    expect(high).toBeLessThan(40);
    expect(high).toBeLessThan(AFE_DECODE_QUEUE_RECOVERY_FILL);
    expect(low).toBeLessThan(high);
    expect(low).toBe(6);
    expect(high).toBeLessThan(AFE_DECODE_QUEUE_HIGH_WATER_CAP);
    expect(streamLookaheadSamples(10, 4)).toBeGreaterThanOrEqual(6);
    const movie = loadMovie(LONG);
    if (!movie) return;
    restore = installNeverEmitDecoder();
    const patched = { ...movie, maxReorderSamples: 10 };
    const decoder = new AfeVideoDecoder(patched);
    expect(decoder.decodeQueueHighWater).toBe(40);
    await decoder.ensure();
    await decoder.recreate();
    expect(decoder.decodeQueueHighWater).toBe(20);
    expect(decoder.decodeQueueLowWater).toBe(6);
    decoder.close();
  }, 10_000);

  it("J. resume only at LOW_WATER or exact frame ready — not refill on every dequeue", async () => {
    const high = decodeQueueHighWater(10, 4);
    const low = decodeQueueLowWater(10, 4);
    expect(
      mayResumeDecode({ decodeQueueSize: high - 1, highWater: high, lowWater: low, exactReady: false, paused: true }),
    ).toBe(false);
    expect(
      mayResumeDecode({ decodeQueueSize: low, highWater: high, lowWater: low, exactReady: false, paused: true }),
    ).toBe(true);
    expect(
      mayResumeDecode({ decodeQueueSize: high, highWater: high, lowWater: low, exactReady: true, paused: true }),
    ).toBe(true);
    expect(
      maySubmitEncoded({
        decodeQueueSize: high - 1,
        highWater: high,
        outputProgressed: true,
        lowWater: low,
        paused: true,
      }),
    ).toBe(false);

    const movie = loadMovie(LONG);
    expect(movie).not.toBeNull();
    restore = installControllableQueueDecoder();
    const decoder = new AfeVideoDecoder({ ...movie!, maxReorderSamples: 10 });
    await decoder.ensure();
    decoder.setGopKeyframeStart(0);
    decoder.beginStream(new Uint8Array(movie!.sampleCount).fill(1), 0, {
      lastRequested: 10,
      lastRequiredDecodeSample: 10,
      requestedIndexes: [10],
    });
    decoder.openRequested(10, decoder.chunkTimestampUs(movie!.samples[10]!));
    await decoder.recreate();
    decoder.setGopKeyframeStart(0);
    decoder.beginStream(new Uint8Array(movie!.sampleCount).fill(1), 0, {
      lastRequested: 10,
      lastRequiredDecodeSample: 10,
      requestedIndexes: [10],
      keepResolved: true,
    });
    decoder.restoreOpenedIdentity(10, decoder.chunkTimestampUs(movie!.samples[10]!));
    const hw = decoder.decodeQueueHighWater;
    const lw = decoder.decodeQueueLowWater;
    for (let i = 0; i < hw; i++) decoder.submitEncoded(movie!.samples[i]!);
    const mid = await decoder.waitForDecodeCapacity(undefined, {
      requested: 10,
      budgetEnd: nowMs() + 40,
    });
    expect(mid).toBe(false);
    const mock = ControllableQueueDecoder.last!;
    mock.drain(1, false);
    expect(mock.decodeQueueSize).toBe(hw - 1);
    expect(hw - 1).toBeGreaterThan(lw);
    const stillPaused = await decoder.waitForDecodeCapacity(undefined, {
      requested: 10,
      budgetEnd: nowMs() + 40,
    });
    expect(stillPaused).toBe(false);
    mock.drain(mock.decodeQueueSize - lw, false);
    expect(mock.decodeQueueSize).toBe(lw);
    const resumed = await decoder.waitForDecodeCapacity(undefined, {
      requested: 10,
      budgetEnd: nowMs() + 40,
    });
    expect(resumed).toBe(true);
    decoder.close();
  }, 10_000);

  it("K. NO-OUTPUT INVARIANT: no output progress + queue>=HIGH_WATER => no more decode(); bounded stall", async () => {
    const high = decodeQueueHighWater(10, 4);
    expect(
      noMoreSubmissionRequired({ decodeQueueSize: high, highWater: high, outputProgressed: false }),
    ).toBe(true);
    expect(
      maySubmitEncoded({ decodeQueueSize: high, highWater: high, outputProgressed: false }),
    ).toBe(false);

    const movie = loadMovie(LONG);
    expect(movie).not.toBeNull();
    restore = installRecoverThenFreezeAtHighWaterDecoder({
      emitBeforeFreeze: 2,
      emitOnInstance: 99,
    });
    const started = nowMs();
    const decoder = new AfeVideoDecoder({ ...movie!, maxReorderSamples: 10 });
    await decoder.ensure();
    decoder.setGopKeyframeStart(0);
    decoder.beginStream(new Uint8Array(movie!.sampleCount).fill(1), 0, {
      lastRequested: 40,
      lastRequiredDecodeSample: 50,
      requestedIndexes: [34],
    });
    decoder.openRequested(34, decoder.chunkTimestampUs(movie!.samples[34]!));
    await decoder.recreate();
    decoder.setGopKeyframeStart(0);
    decoder.beginStream(new Uint8Array(movie!.sampleCount).fill(1), 0, {
      lastRequested: 40,
      lastRequiredDecodeSample: 50,
      requestedIndexes: [34],
      keepResolved: true,
    });
    decoder.setStallPhase("PUMP_LOOKAHEAD");
    const hw = decoder.decodeQueueHighWater;
    for (let i = 0; i < hw + 8 && i < movie!.sampleCount; i++) {
      const can = await decoder.waitForDecodeCapacity(undefined, {
        requested: 34,
        budgetEnd: nowMs() + 200,
      });
      if (!can) break;
      decoder.submitEncoded(movie!.samples[i]!);
    }
    const elapsed = nowMs() - started;
    const dump = decoder.snapshot({ sourceSampleRequested: 34 });
    expect(dump.noMoreSubmission || dump.frozenAtHighWater || dump.backpressureBlocked).toBe(true);
    expect(dump.decodeQueuePeak).toBeLessThan(40);
    expect(dump.decodeQueuePeak).toBeLessThan(125);
    expect(elapsed).toBeLessThan(1_000);
    decoder.close();
  }, 10_000);

  it("L. gopStart==0 → earlierKeyframeAvailable=false; no AFE-13 escape loop", async () => {
    const movie = loadMovie(LONG);
    expect(movie).not.toBeNull();
    expect(decodeOrigin(movie!, 34) === 0 || decodeOrigin(movie!, 0) === 0).toBe(true);
    expect(earlierKeyframeOrigin(movie!, 0)).toBeNull();
    restore = installRecoverThenFreezeAtHighWaterDecoder({
      emitBeforeFreeze: 3,
      emitOnInstance: 99,
    });
    const scheduler = new AfeScheduler({ ...movie!, maxReorderSamples: 10 }, 12);
    const started = nowMs();
    try {
      await expect(async () => {
        for await (const frame of scheduler.getFramesAt(times(LONG, 40, 30, "afe-14-l"))) {
          expect(frame).not.toBeNull();
          frame?.close();
        }
      }).rejects.toMatchObject({ name: "AfeError", code: "AFE_DECODE_STALL" });
    } finally {
      const elapsed = nowMs() - started;
      const dump = scheduler.stallSnapshot({
        videoFramesRequested: 1,
        videoFramesDecoded: 0,
        videoFramesEncoded: 0,
      });
      expect(dump.gopKeyframeStart).toBe(0);
      expect(dump.earlierKeyframeAvailable).toBe(false);
      expect(dump.earlierKeyframeRecovered).toBe(false);
      expect(dump.decoderFlushCount).toBe(0);
      expect(elapsed).toBeLessThan(2_500);
      expect(formatStallMessage(dump)).toContain("earlierKeyframeAvailable no");
      scheduler.close();
    }
  }, 15_000);

  it("M. FINAL_FLUSH AFE-11 intact; no mid-run flush; no PREFETCH bump; no software decode", () => {
    expect(getAfeSequentialPrefetch()).toBe(4);
    expect(
      mayFinalFlush({
        unresolvedRequestedVideoFrames: 1,
        nextDecode: 56,
        sampleCount: 240,
        lastRequiredDecodeSample: 92,
        lastSubmittedSample: 55,
        streamWaiterIndex: null,
        pendingPts: [],
        recoveryRebuilding: false,
        transactionComplete: false,
      }),
    ).toBe(false);
    expect(
      mayFinalFlush({
        unresolvedRequestedVideoFrames: 1,
        nextDecode: 93,
        sampleCount: 240,
        lastRequiredDecodeSample: 92,
        lastSubmittedSample: 92,
        streamWaiterIndex: null,
        pendingPts: [],
        recoveryRebuilding: false,
        transactionComplete: false,
      }),
    ).toBe(true);
    expect(lastRequiredDecodeSample({
      lastRequested: 68,
      maxReorderSamples: 10,
      prefetch: 4,
      sampleCount: 240,
    })).toBeGreaterThan(68);
  });

  it("N. diagnostic cleanup + no VIDEO fallback language in stall dump", async () => {
    const movie = loadMovie(BFRAME);
    expect(movie).not.toBeNull();
    restore = installHangFlushDecoder();
    const scheduler = new AfeScheduler(movie!, 12);
    try {
      await expect(async () => {
        for await (const frame of scheduler.getFramesAt(times(BFRAME, 4, 30, "afe-14-n"))) {
          expect(frame).not.toBeNull();
          frame?.close();
        }
      }).rejects.toMatchObject({ name: "AfeError", code: "AFE_DECODE_STALL" });
    } finally {
      const dump = scheduler.stallSnapshot({
        videoFramesRequested: 1,
        videoFramesDecoded: 0,
        videoFramesEncoded: 0,
      });
      const text = formatStallMessage(dump);
      expect(text).toContain("gopStart");
      expect(text).toContain("decodeStart");
      expect(text).toContain("firstSubmittedAfterRecreate");
      expect(text).toContain("packetParity");
      expect(text).toContain("configParity");
      expect(text).toContain("earlierKeyframeAvailable");
      expect(text).toContain("decodeQueueLowWater");
      expect(text).toContain("postRecreate");
      expect(text).not.toMatch(/nearest|snap|dup|last-good|paintFallback|allowSkip|software decode/i);
      expect(dump.transactionComplete).toBe(false);
      scheduler.close();
    }
  }, 15_000);
});
