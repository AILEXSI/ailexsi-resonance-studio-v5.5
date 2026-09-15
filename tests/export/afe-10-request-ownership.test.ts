import { existsSync, readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import {
  AfeScheduler,
  AfeVideoDecoder,
  formatStallMessage,
  hasFurtherUsefulInput,
  lastRequiredDecodeSample,
  mayFinalFlush,
  parseIsoBmff,
  progressivePumpSliceEnd,
  requestOwnershipHolds,
  requestedEncodedInvariantHolds,
  streamLookaheadSamples,
} from "../../src/core/frame-engine";
import { sequentialTimes } from "./afe-plan";
import {
  installHoldUntilSubmittedDecoder,
  installNeverEmitDecoder,
  installRecoverOnResetDecoder,
  installRecoverThenNeedDecoder,
  installSkipPtsDecoder,
} from "./afe-videodecoder-mock";

const PATH = "tests/fixtures/afe/afe-bframe-30-g30-2s.mp4";

function loadMovie() {
  if (!existsSync(PATH)) return null;
  return parseIsoBmff(new Uint8Array(readFileSync(PATH)));
}

function times(frames: number) {
  return sequentialTimes({
    id: "afe-10",
    path: PATH,
    fps: 30,
    frames,
    seconds: frames / 30,
    gop: 30,
    keyframeSec: [0],
  });
}

describe("AFE-10 A–J open VIDEO request keeps decode ownership until exact PTS", () => {
  let restore: (() => void) | undefined;
  afterEach(() => {
    restore?.();
    restore = undefined;
  });

  it("A. unresolved>0 must imply waiter OR pending PTS OR recovery rebuilding", () => {
    expect(
      requestOwnershipHolds({
        unresolvedRequestedVideoFrames: 1,
        streamWaiterIndex: 38,
        pendingPtsCount: 0,
        recoveryRebuilding: false,
      }),
    ).toBe(true);
    expect(
      requestOwnershipHolds({
        unresolvedRequestedVideoFrames: 1,
        streamWaiterIndex: null,
        pendingPts: [1_625_000],
        recoveryRebuilding: false,
      }),
    ).toBe(true);
    expect(
      requestOwnershipHolds({
        unresolvedRequestedVideoFrames: 1,
        streamWaiterIndex: null,
        pendingPtsCount: 0,
        recoveryRebuilding: true,
      }),
    ).toBe(true);
    expect(
      requestOwnershipHolds({
        unresolvedRequestedVideoFrames: 0,
        streamWaiterIndex: null,
        pendingPtsCount: 0,
        recoveryRebuilding: false,
      }),
    ).toBe(true);
    expect(
      requestOwnershipHolds({
        unresolvedRequestedVideoFrames: 1,
        streamWaiterIndex: null,
        pendingPts: [],
        pendingPtsCount: 0,
        recoveryRebuilding: false,
      }),
    ).toBe(false);
  });

  it("B. Windows shape (unresolved=1, waiter=null, pending=[], streamPts=0) is immediate OWNERSHIP_LOST", async () => {
    const movie = loadMovie();
    if (!movie) return;
    restore = installNeverEmitDecoder();
    const decoder = new AfeVideoDecoder(movie);
    await decoder.ensure();
    decoder.beginStream(new Uint8Array(movie.sampleCount).fill(1), 0, {
      lastRequested: 140,
      lastRequiredDecodeSample: 140,
    });
    decoder.openRequested(38, 1_625_000);
    decoder.bindOrigin({
      sourceSampleRequested: 38,
      requestedPtsUs: 1_625_000,
      originRequestedSample: 38,
      originRequestedPts: 1_625_000,
    });
    expect(decoder.unresolvedRequestedCount()).toBe(1);
    expect(decoder.snapshot().streamWaiterIndex).toBeNull();
    expect(decoder.snapshot().streamPtsPending).toBe(0);
    const started = Date.now();
    try {
      decoder.assertOpenedOwnership({
        sourceSampleRequested: 38,
        requestedPtsUs: 1_625_000,
        videoFramesRequested: 47,
        videoFramesDecoded: 46,
        videoFramesEncoded: 46,
      });
      expect.fail("expected AFE_REQUEST_OWNERSHIP_LOST");
    } catch (e) {
      expect(e).toMatchObject({ name: "AfeError", code: "AFE_REQUEST_OWNERSHIP_LOST" });
      expect(Date.now() - started).toBeLessThan(500);
      const dump = decoder.snapshot({
        sourceSampleRequested: 38,
        requestedPtsUs: 1_625_000,
      });
      const text = formatStallMessage(dump);
      expect(text).toContain("requested sample 38 PTS 1625000");
      expect(text).toContain("ownershipState OWNERSHIP_LOST");
      expect(text).toMatch(/ptsRegistered no/);
      expect(text).toMatch(/waiterActive no/);
      expect(text).not.toMatch(/nearest|snap|neighbor|paintFallback|allowSkip/i);
    }
    decoder.close();
  }, 10_000);

  it("C. recreate restores opened identity, exact PTS, protected role, PtsIndexMap, waiter", async () => {
    const movie = loadMovie();
    if (!movie) return;
    restore = installRecoverOnResetDecoder();
    const scheduler = new AfeScheduler(movie, 12);
    const out: number[] = [];
    try {
      for await (const frame of scheduler.getFramesAt(times(6))) {
        expect(frame).not.toBeNull();
        out.push(frame!.timestamp);
        frame!.close();
      }
    } finally {
      const dump = scheduler.stallSnapshot();
      expect(dump.decoderRecreateCount).toBe(1);
      expect(dump.recoveryAttempts).toBe(1);
      expect(dump.ownershipRebuilt).toBe(true);
      expect(dump.decoderFlushCount).toBe(0);
      expect(dump.originRequestedSample).not.toBeNull();
      scheduler.close();
    }
    expect(out).toHaveLength(6);
  }, 15_000);

  it("D. TRACE sample 38: OPEN_REQUEST…ENCODED and RECOVERY_START…WAIT_REINSTALLED", async () => {
    const movie = loadMovie();
    if (!movie) return;
    restore = installRecoverOnResetDecoder();
    const decoder = new AfeVideoDecoder(movie);
    await decoder.ensure();
    const pts = decoder.chunkTimestampUs(movie.samples[3]!);
    decoder.beginStream(new Uint8Array([1, 1, 1, 1]), 0, {
      lastRequested: 3,
      lastRequiredDecodeSample: 8,
      requestedIndexes: [0, 1, 2, 3],
    });
    decoder.openRequested(3, pts);
    decoder.bindOrigin({ sourceSampleRequested: 3, requestedPtsUs: pts });
    for (let i = 0; i <= 3; i++) decoder.submitEncoded(movie.samples[i]!);
    expect(decoder.ownershipTrace(3)).toContain("OPEN_REQUEST");
    expect(decoder.ownershipTrace(3)).toContain("PTS_REGISTERED");
    decoder.markRecoveryRebuilding([3]);
    await decoder.recreate();
    decoder.beginStream(new Uint8Array([1, 1, 1, 1]), 0, {
      lastRequested: 3,
      lastRequiredDecodeSample: 8,
      requestedIndexes: [0, 1, 2, 3],
      keepResolved: true,
    });
    decoder.restoreOpenedIdentity(3, pts);
    for (let i = 0; i <= 3; i++) decoder.submitEncoded(movie.samples[i]!);
    decoder.confirmPtsRegistered(3, pts);
    const wait = decoder.awaitReady(3, undefined, { requestedPtsUs: pts }, {
      allowSkip: false,
      throwOnTimeout: false,
      timeoutMs: 80,
    });
    const frame = await wait;
    expect(frame).not.toBeNull();
    frame!.close();
    decoder.markEncoded(3);
    const trace = decoder.ownershipTrace(3);
    expect(trace).toContain("OPEN_REQUEST");
    expect(trace).toContain("PTS_REGISTERED");
    expect(trace).toContain("RECOVERY_START");
    expect(trace).toContain("RECOVERY_REBUILDING");
    expect(trace).toContain("WAIT_REINSTALLED");
    expect(trace).toContain("RESOLVED");
    expect(trace).toContain("ENCODED");
    expect(trace.indexOf("RECOVERY_START")).toBeLessThan(trace.indexOf("WAIT_REINSTALLED"));
    expect(trace.indexOf("OPEN_REQUEST")).toBeLessThan(trace.indexOf("ENCODED"));
    expect(trace).not.toContain("OWNERSHIP_LOST");
    decoder.close();
  }, 10_000);

  it("E. progressive pump: bounded slices toward lastRequired; stop when exact PTS resolves", async () => {
    const movie = loadMovie();
    if (!movie) return;
    const look = streamLookaheadSamples(movie.maxReorderSamples, 4);
    expect(
      progressivePumpSliceEnd({
        nextDecode: 44,
        lastRequiredDecodeSample: 140,
        sampleCount: 141,
        sliceSamples: look,
      }),
    ).toBe(44 + look - 1);
    expect(
      progressivePumpSliceEnd({
        nextDecode: 138,
        lastRequiredDecodeSample: 140,
        sampleCount: 141,
        sliceSamples: look,
      }),
    ).toBe(140);
    restore = installHoldUntilSubmittedDecoder(36);
    const scheduler = new AfeScheduler(movie, 12);
    const out: number[] = [];
    try {
      for await (const frame of scheduler.getFramesAt(times(50))) {
        expect(frame).not.toBeNull();
        out.push(frame!.timestamp);
        frame!.close();
      }
    } finally {
      const dump = scheduler.stallSnapshot();
      expect(dump.decoderFlushCount).toBe(0);
      expect(dump.lastSubmittedSample).toBeGreaterThanOrEqual(35);
      expect((dump.lastSubmittedSample ?? 0) <= (dump.lastRequiredDecodeSample ?? 0)).toBe(true);
      expect(dump.pumpSliceEnd).not.toBeNull();
      scheduler.close();
    }
    expect(out).toHaveLength(50);
  }, 15_000);

  it("F. progressive pump does not FINAL_FLUSH while submitted < lastRequired", () => {
    expect(
      hasFurtherUsefulInput({
        nextDecode: 45,
        sampleCount: 141,
        lastRequiredDecodeSample: 140,
      }),
    ).toBe(true);
    expect(
      mayFinalFlush({
        unresolvedRequestedVideoFrames: 1,
        nextDecode: 45,
        sampleCount: 141,
        lastRequiredDecodeSample: 140,
      }),
    ).toBe(false);
    expect(
      formatStallMessage({
        lastSubmittedSample: 44,
        lastRequiredDecodeSample: 140,
        decoderFlushCount: 0,
        finalFlushAttempted: false,
        unresolvedRequestedVideoFrames: 1,
      }),
    ).toMatch(/FINAL_FLUSH no/);
  });

  it("G. FINAL_FLUSH only after useful input exhausted (lastSubmitted>=lastRequired)", async () => {
    expect(
      mayFinalFlush({
        unresolvedRequestedVideoFrames: 1,
        nextDecode: 141,
        sampleCount: 141,
        lastRequiredDecodeSample: 140,
      }),
    ).toBe(true);
    expect(
      mayFinalFlush({
        unresolvedRequestedVideoFrames: 0,
        nextDecode: 141,
        sampleCount: 141,
        lastRequiredDecodeSample: 140,
      }),
    ).toBe(false);
    const movie = loadMovie();
    if (!movie) return;
    restore = installNeverEmitDecoder();
    const decoder = new AfeVideoDecoder(movie);
    await decoder.ensure();
    const lastRequired = lastRequiredDecodeSample({
      lastRequested: 0,
      maxReorderSamples: movie.maxReorderSamples,
      prefetch: 4,
      sampleCount: movie.sampleCount,
    });
    decoder.beginStream(new Uint8Array([1]), 0, {
      lastRequested: 0,
      lastRequiredDecodeSample: lastRequired,
      requestedIndexes: [0],
    });
    decoder.openRequested(0);
    for (let i = 0; i <= lastRequired; i++) decoder.submitEncoded(movie.samples[i]!);
    await decoder.flushTail();
    expect(decoder.snapshot().finalFlushAttempted).toBe(true);
    expect(decoder.snapshot().decoderFlushCount).toBe(1);
    decoder.close();
  }, 10_000);

  it("H. no VIDEO fallback: missing exact PTS is typed stall, never nearest/null/VIS/BLACK", async () => {
    const movie = loadMovie();
    if (!movie) return;
    const missingPts = new AfeVideoDecoder(movie).chunkTimestampUs(movie.samples[3]!);
    restore = installSkipPtsDecoder([missingPts]);
    const scheduler = new AfeScheduler(movie, 12);
    try {
      await expect(async () => {
        for await (const frame of scheduler.getFramesAt(times(6))) {
          expect(frame).not.toBeNull();
          frame?.close();
        }
      }).rejects.toMatchObject({ name: "AfeError", code: "AFE_DECODE_STALL" });
    } finally {
      const text = formatStallMessage(scheduler.stallSnapshot());
      expect(text).not.toMatch(/nearest|snap|neighbor|paintFallback|allowSkip|VIS|BLACK/i);
      expect(scheduler.stallSnapshot().transactionComplete).toBe(false);
      scheduler.close();
    }
  }, 15_000);

  it("I. failure dump shows pump slice, lastSubmitted/Required, PTS, waiter, rebuilt, FINAL_FLUSH", () => {
    const text = formatStallMessage({
      sourceSampleRequested: 38,
      requestedPtsUs: 1_625_000,
      originRequestedSample: 38,
      originRequestedPts: 1_625_000,
      lastSubmittedSample: 44,
      lastRequiredDecodeSample: 140,
      lastRequestedSample: 140,
      pumpSliceStart: 44,
      pumpSliceEnd: 51,
      ptsRegistered: false,
      ownershipWaiterActive: false,
      ownershipRebuilt: true,
      recoveryRebuilding: false,
      ownershipState: "OWNERSHIP_LOST",
      finalFlushAttempted: false,
      unresolvedRequestedVideoFrames: 1,
      openedRequestedVideoFrames: 47,
      videoFramesRequested: 47,
      videoFramesDecoded: 46,
      videoFramesEncoded: 46,
      stallPhase: "WAIT_EXACT_PTS",
    });
    expect(text).toContain("pumpSlice 44-51");
    expect(text).toContain("lastSubmittedSample 44 (sample-index)");
    expect(text).toContain("lastRequiredDecodeSample 140 (sample-index)");
    expect(text).toContain("ptsRegistered no");
    expect(text).toContain("waiterActive no");
    expect(text).toContain("ownershipRebuilt yes");
    expect(text).toContain("FINAL_FLUSH no");
    expect(text).toContain("ownershipState OWNERSHIP_LOST");
  });

  it("J. true missing exact PTS with ownership intact is AFE_DECODE_STALL (Enc < Req)", async () => {
    const movie = loadMovie();
    if (!movie) return;
    restore = installRecoverThenNeedDecoder(200);
    const scheduler = new AfeScheduler(movie, 12);
    try {
      await expect(async () => {
        for await (const frame of scheduler.getFramesAt(times(6))) {
          frame?.close();
        }
      }).rejects.toMatchObject({ name: "AfeError", code: "AFE_DECODE_STALL" });
    } finally {
      const dump = scheduler.stallSnapshot({
        videoFramesRequested: 1,
        videoFramesDecoded: 0,
        videoFramesEncoded: 0,
      });
      expect(dump.unresolvedRequestedVideoFrames).toBeGreaterThan(0);
      expect(dump.transactionComplete).toBe(false);
      expect(dump.originRequestedSample).not.toBeNull();
      expect(dump.originRequestedPts).not.toBeNull();
      expect(
        requestedEncodedInvariantHolds({
          unresolvedRequestedVideoFrames: dump.unresolvedRequestedVideoFrames,
          videoFramesRequested: 1,
          videoFramesEncoded: 0,
        }),
      ).toBe(true);
      expect(dump.decoderFlushCount).toBe(0);
      expect(formatStallMessage(dump)).toMatch(/FINAL_FLUSH no/);
      scheduler.close();
    }
  }, 15_000);
});
