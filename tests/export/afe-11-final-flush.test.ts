import { existsSync, readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import {
  AFE_DECODE_STALL_MS,
  AfeScheduler,
  AfeVideoDecoder,
  formatStallMessage,
  isTransactionComplete,
  isTrueTransactionTail,
  lastRequiredDecodeSample,
  mayFinalFlush,
  parseIsoBmff,
  requestOwnershipHolds,
  requestedEncodedInvariantHolds,
  usefulInputExhausted,
} from "../../src/core/frame-engine";
import { sequentialTimes } from "./afe-plan";
import {
  installHangFlushDecoder,
  installNeverEmitDecoder,
  installQueueHeldDecoder,
  installSkipPtsDecoder,
} from "./afe-videodecoder-mock";

const PATH = "tests/fixtures/afe/afe-bframe-30-g30-2s.mp4";

function loadMovie() {
  if (!existsSync(PATH)) return null;
  return parseIsoBmff(new Uint8Array(readFileSync(PATH)));
}

function times(frames: number) {
  return sequentialTimes({
    id: "afe-11",
    path: PATH,
    fps: 30,
    frames,
    seconds: frames / 30,
    gop: 30,
    keyframeSec: [0],
  });
}

/** Windows AFE-10 leftover: sample 38 open, lastRequested 90, lastRequired 96, submitted 96. */
const WINDOWS = {
  requested: 38,
  lastRequested: 90,
  lastRequired: 96,
  lastSubmitted: 96,
  nextDecode: 97,
  sampleCount: 141,
};

describe("AFE-11 A–J FINAL_FLUSH when useful input is exhausted for an open request", () => {
  let restore: (() => void) | undefined;
  afterEach(() => {
    restore?.();
    restore = undefined;
  });

  it("A. FINAL_FLUSH allowed when useful input exhausted even if current sample is not run-tail", () => {
    expect(
      isTrueTransactionTail({
        requested: WINDOWS.requested,
        lastRequested: WINDOWS.lastRequested,
        nextDecode: WINDOWS.nextDecode,
        sampleCount: WINDOWS.sampleCount,
      }),
    ).toBe(false);
    expect(
      usefulInputExhausted({
        lastSubmittedSample: WINDOWS.lastSubmitted,
        lastRequiredDecodeSample: WINDOWS.lastRequired,
        nextDecode: WINDOWS.nextDecode,
        sampleCount: WINDOWS.sampleCount,
      }),
    ).toBe(true);
    expect(
      mayFinalFlush({
        unresolvedRequestedVideoFrames: 1,
        nextDecode: WINDOWS.nextDecode,
        sampleCount: WINDOWS.sampleCount,
        lastRequiredDecodeSample: WINDOWS.lastRequired,
        lastSubmittedSample: WINDOWS.lastSubmitted,
        streamWaiterIndex: null,
        pendingPts: [],
        recoveryRebuilding: false,
        transactionComplete: false,
      }),
    ).toBe(true);
  });

  it("B. FINAL_FLUSH forbidden while lastSubmitted < lastRequired or waiter/recovery/complete", () => {
    expect(
      mayFinalFlush({
        unresolvedRequestedVideoFrames: 1,
        nextDecode: 45,
        sampleCount: 141,
        lastRequiredDecodeSample: 140,
        lastSubmittedSample: 44,
        streamWaiterIndex: null,
        pendingPts: [],
        recoveryRebuilding: false,
        transactionComplete: false,
      }),
    ).toBe(false);
    expect(
      mayFinalFlush({
        unresolvedRequestedVideoFrames: 1,
        nextDecode: WINDOWS.nextDecode,
        sampleCount: WINDOWS.sampleCount,
        lastRequiredDecodeSample: WINDOWS.lastRequired,
        lastSubmittedSample: WINDOWS.lastSubmitted,
        streamWaiterIndex: 38,
        pendingPts: [],
        recoveryRebuilding: false,
        transactionComplete: false,
      }),
    ).toBe(false);
    expect(
      mayFinalFlush({
        unresolvedRequestedVideoFrames: 1,
        nextDecode: WINDOWS.nextDecode,
        sampleCount: WINDOWS.sampleCount,
        lastRequiredDecodeSample: WINDOWS.lastRequired,
        lastSubmittedSample: WINDOWS.lastSubmitted,
        streamWaiterIndex: null,
        pendingPts: [1_625_000],
        recoveryRebuilding: false,
        transactionComplete: false,
      }),
    ).toBe(false);
    expect(
      mayFinalFlush({
        unresolvedRequestedVideoFrames: 1,
        nextDecode: WINDOWS.nextDecode,
        sampleCount: WINDOWS.sampleCount,
        lastRequiredDecodeSample: WINDOWS.lastRequired,
        lastSubmittedSample: WINDOWS.lastSubmitted,
        recoveryRebuilding: true,
      }),
    ).toBe(false);
    expect(
      mayFinalFlush({
        unresolvedRequestedVideoFrames: 1,
        nextDecode: WINDOWS.nextDecode,
        sampleCount: WINDOWS.sampleCount,
        lastRequiredDecodeSample: WINDOWS.lastRequired,
        lastSubmittedSample: WINDOWS.lastSubmitted,
        transactionComplete: true,
      }),
    ).toBe(false);
    expect(
      mayFinalFlush({
        unresolvedRequestedVideoFrames: 0,
        nextDecode: WINDOWS.nextDecode,
        sampleCount: WINDOWS.sampleCount,
        lastRequiredDecodeSample: WINDOWS.lastRequired,
        lastSubmittedSample: WINDOWS.lastSubmitted,
      }),
    ).toBe(false);
  });

  it("C. unresolved>0 holds iff waiter OR ptsRegistered/pending OR recovery (FINAL_FLUSH_ARMED is not identity)", () => {
    expect(
      requestOwnershipHolds({
        unresolvedRequestedVideoFrames: 1,
        streamWaiterIndex: null,
        pendingPts: [],
        ptsRegistered: false,
        recoveryRebuilding: false,
        finalFlushArmed: false,
      }),
    ).toBe(false);
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
        ptsRegistered: true,
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
        unresolvedRequestedVideoFrames: 1,
        streamWaiterIndex: null,
        pendingPtsCount: 0,
        recoveryRebuilding: false,
        finalFlushArmed: true,
      }),
    ).toBe(false);
    expect(
      requestOwnershipHolds({
        unresolvedRequestedVideoFrames: 1,
        streamWaiterIndex: null,
        pendingPtsCount: 0,
        recoveryRebuilding: false,
        finalFlushInProgress: true,
      }),
    ).toBe(false);
    expect(
      requestOwnershipHolds({
        unresolvedRequestedVideoFrames: 1,
        streamWaiterIndex: null,
        pendingPtsCount: 0,
        ptsRegistered: true,
        recoveryRebuilding: false,
        finalFlushArmed: true,
      }),
    ).toBe(true);
  });

  it("D. QueueHeld mid-run (not atTail) FINAL_FLUSH releases exact PTS", async () => {
    const movie = loadMovie();
    if (!movie) return;
    restore = installQueueHeldDecoder();
    const scheduler = new AfeScheduler(movie, 12);
    const out: number[] = [];
    try {
      for await (const frame of scheduler.getFramesAt(times(8))) {
        expect(frame).not.toBeNull();
        out.push(frame!.timestamp);
        frame!.close();
      }
    } finally {
      const dump = scheduler.stallSnapshot();
      expect(dump.decoderFlushCount).toBeGreaterThanOrEqual(1);
      expect(dump.finalFlushAttempted).toBe(true);
      expect(dump.usefulInputExhausted).toBe(true);
      expect(dump.transactionComplete === false || dump.unresolvedRequestedVideoFrames === 0).toBe(true);
      scheduler.close();
    }
    expect(out).toHaveLength(8);
    for (let i = 1; i < out.length; i++) expect(out[i]!).toBeGreaterThan(out[i - 1]!);
  }, 15_000);

  it("E. WAIT_EXACT_PTS → arm FINAL_FLUSH once after lastRequired, then exact or stall", async () => {
    const movie = loadMovie();
    if (!movie) return;
    restore = installNeverEmitDecoder();
    const decoder = new AfeVideoDecoder(movie);
    await decoder.ensure();
    const lastRequired = lastRequiredDecodeSample({
      lastRequested: 90,
      maxReorderSamples: movie.maxReorderSamples,
      prefetch: 4,
      sampleCount: movie.sampleCount,
    });
    decoder.beginStream(new Uint8Array(movie.sampleCount).fill(1), 0, {
      lastRequested: 90,
      lastRequiredDecodeSample: lastRequired,
      requestedIndexes: [38],
    });
    decoder.openRequested(38, 1_625_000);
    decoder.bindOrigin({
      sourceSampleRequested: 38,
      requestedPtsUs: 1_625_000,
      originRequestedSample: 38,
      originRequestedPts: 1_625_000,
    });
    decoder.setStallPhase("WAIT_EXACT_PTS");
    for (let i = 0; i <= lastRequired; i++) decoder.submitEncoded(movie.samples[i]!);
    expect(decoder.usefulInputIsExhausted()).toBe(true);
    expect(decoder.snapshot().finalFlushAttempted).toBe(false);
    decoder.clearRecoveryRebuilding([38]);
    decoder.armFinalFlush([38]);
    expect(decoder.ownershipTrace(38)).toContain("FINAL_FLUSH_ARMED");
    decoder.assertOpenedOwnership({ sourceSampleRequested: 38, requestedPtsUs: 1_625_000 });
    await decoder.flushTail();
    expect(decoder.snapshot().finalFlushAttempted).toBe(true);
    expect(decoder.snapshot().decoderFlushCount).toBe(1);
    expect(decoder.snapshot().stallPhase).toBe("FINAL_FLUSH");
    decoder.close();
  }, 10_000);

  it("F. hung FINAL_FLUSH mid-run (not atTail) is AFE_DECODE_STALL with origin + phase", async () => {
    const movie = loadMovie();
    if (!movie) return;
    restore = installHangFlushDecoder();
    const scheduler = new AfeScheduler(movie, 12);
    const started = Date.now();
    try {
      await expect(async () => {
        for await (const frame of scheduler.getFramesAt(times(6))) {
          frame?.close();
        }
      }).rejects.toMatchObject({ name: "AfeError", code: "AFE_DECODE_STALL" });
    } finally {
      const dump = scheduler.stallSnapshot();
      expect(dump.originRequestedSample).not.toBeNull();
      expect(dump.originRequestedPts).not.toBeNull();
      expect(dump.stallPhase === "FINAL_FLUSH" || dump.decoderFlushCount >= 1).toBe(true);
      expect(dump.transactionComplete).toBe(false);
      expect(dump.unresolvedRequestedVideoFrames).toBeGreaterThan(0);
      expect(Date.now() - started).toBeGreaterThanOrEqual(AFE_DECODE_STALL_MS - 80);
      scheduler.close();
    }
  }, 15_000);

  it("G. after FINAL_FLUSH exact PTS still missing → AFE_DECODE_STALL, not complete", async () => {
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
      const dump = scheduler.stallSnapshot({
        videoFramesRequested: 4,
        videoFramesDecoded: 3,
        videoFramesEncoded: 3,
      });
      expect(dump.unresolvedRequestedVideoFrames).toBeGreaterThan(0);
      expect(dump.transactionComplete).toBe(false);
      expect(dump.finalFlushAttempted).toBe(true);
      expect(
        isTransactionComplete({
          unresolvedRequestedVideoFrames: dump.unresolvedRequestedVideoFrames,
          streamWaiterIndex: dump.streamWaiterIndex,
        }),
      ).toBe(false);
      expect(
        requestedEncodedInvariantHolds({
          unresolvedRequestedVideoFrames: dump.unresolvedRequestedVideoFrames,
          videoFramesRequested: 4,
          videoFramesEncoded: 3,
        }),
      ).toBe(true);
      expect(formatStallMessage(dump)).not.toMatch(/nearest|snap|neighbor|paintFallback|allowSkip/i);
      scheduler.close();
    }
  }, 15_000);

  it("H. honest dump fields for Windows sample 38 / useful-input-exhausted shape", () => {
    const text = formatStallMessage({
      sourceSampleRequested: 38,
      requestedPtsUs: 1_625_000,
      originRequestedSample: 38,
      originRequestedPts: 1_625_000,
      lastSubmittedSample: 96,
      lastRequiredDecodeSample: 96,
      lastRequestedSample: 90,
      decodeQueueSize: 81,
      decoderFlushCount: 0,
      ptsRegistered: false,
      ownershipWaiterActive: false,
      ownershipRebuilt: true,
      recoveryRebuilding: false,
      ownershipState: "WAIT_REINSTALLED",
      finalFlushAttempted: false,
      finalFlushArmed: false,
      usefulInputExhausted: true,
      unresolvedRequestedVideoFrames: 1,
      openedRequestedVideoFrames: 47,
      videoFramesRequested: 47,
      videoFramesDecoded: 46,
      videoFramesEncoded: 46,
      stallPhase: "WAIT_EXACT_PTS",
      transactionComplete: false,
    });
    expect(text).toContain("requested sample 38 PTS 1625000");
    expect(text).toContain("videoReq 47 (frame-count)");
    expect(text).toContain("videoDec 46 (frame-count)");
    expect(text).toContain("videoEnc 46 (frame-count)");
    expect(text).toContain("unresolvedRequested 1");
    expect(text).toContain("lastSubmittedSample 96 (sample-index)");
    expect(text).toContain("lastRequestedSample 90 (sample-index)");
    expect(text).toContain("lastRequiredDecodeSample 96 (sample-index)");
    expect(text).toContain("decodeQueue 81");
    expect(text).toContain("flushes 0");
    expect(text).toContain("FINAL_FLUSH no");
    expect(text).toContain("ptsRegistered no");
    expect(text).toContain("waiterActive no");
    expect(text).toContain("ownershipRebuilt yes");
    expect(text).toContain("recoveryRebuilding no");
    expect(text).toContain("ownershipState WAIT_REINSTALLED");
    expect(text).toContain("usefulInputExhausted yes");
    expect(text).toContain("transactionComplete false");
    expect(text).not.toMatch(/nearest|snap|dup|last-good|paintFallback|allowSkip/i);
  });

  it("I. no fake success: unresolved>0 is never transactionComplete; no drop", () => {
    expect(
      isTransactionComplete({
        unresolvedRequestedVideoFrames: 1,
        streamWaiterIndex: null,
        openedRequestedVideoFrames: 47,
        resolvedRequestedVideoFrames: 46,
        videoFramesRequested: 47,
        videoFramesDecoded: 46,
        videoFramesEncoded: 46,
      }),
    ).toBe(false);
    expect(
      requestedEncodedInvariantHolds({
        unresolvedRequestedVideoFrames: 1,
        videoFramesRequested: 47,
        videoFramesEncoded: 46,
      }),
    ).toBe(true);
    expect(
      requestedEncodedInvariantHolds({
        unresolvedRequestedVideoFrames: 1,
        videoFramesRequested: 47,
        videoFramesEncoded: 47,
      }),
    ).toBe(false);
  });

  it("J. unresolved + no waiter/pts/recovery/FINAL_FLUSH is immediate OWNERSHIP_LOST", async () => {
    const movie = loadMovie();
    if (!movie) return;
    restore = installNeverEmitDecoder();
    const decoder = new AfeVideoDecoder(movie);
    await decoder.ensure();
    decoder.beginStream(new Uint8Array(movie.sampleCount).fill(1), 0, {
      lastRequested: 90,
      lastRequiredDecodeSample: 96,
    });
    decoder.openRequested(38, 1_625_000);
    decoder.bindOrigin({
      sourceSampleRequested: 38,
      requestedPtsUs: 1_625_000,
      originRequestedSample: 38,
      originRequestedPts: 1_625_000,
    });
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
      const text = formatStallMessage(
        decoder.snapshot({
          sourceSampleRequested: 38,
          requestedPtsUs: 1_625_000,
        }),
      );
      expect(text).toContain("requested sample 38 PTS 1625000");
      expect(text).toContain("ownershipState OWNERSHIP_LOST");
      expect(text).toMatch(/ptsRegistered no/);
      expect(text).toMatch(/waiterActive no/);
      expect(text).toMatch(/FINAL_FLUSH no/);
    }
    decoder.armFinalFlush([38]);
    decoder.assertOpenedOwnership({ sourceSampleRequested: 38, requestedPtsUs: 1_625_000 });
    decoder.close();
  }, 10_000);
});
