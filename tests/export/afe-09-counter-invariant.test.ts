import { existsSync, readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import {
  AfeScheduler,
  AfeVideoDecoder,
  formatStallMessage,
  isExportTransactionComplete,
  isTransactionComplete,
  lastRequiredDecodeSample,
  parseIsoBmff,
  requestedEncodedInvariantHolds,
} from "../../src/core/frame-engine";
import { sequentialTimes } from "./afe-plan";
import {
  installEmitThenHoldHangFlushDecoder,
  installHoldDecoder,
  installNeverEmitDecoder,
  installSkipPtsDecoder,
} from "./afe-videodecoder-mock";

const PATH = "tests/fixtures/afe/afe-bframe-30-g30-2s.mp4";

function loadMovie() {
  if (!existsSync(PATH)) return null;
  return parseIsoBmff(new Uint8Array(readFileSync(PATH)));
}

function times(frames: number) {
  return sequentialTimes({
    id: "afe-09",
    path: PATH,
    fps: 30,
    frames,
    seconds: frames / 30,
    gop: 30,
    keyframeSec: [0],
  });
}

describe("AFE-09 opened-request ledger vs Enc/Req invariant", () => {
  let restore: (() => void) | undefined;
  afterEach(() => {
    restore?.();
    restore = undefined;
  });

  it("Enc==Req with leftover decodeQueue is COMPLETE + cancel, no stall", async () => {
    const movie = loadMovie();
    if (!movie) return;
    restore = installEmitThenHoldHangFlushDecoder(8);
    const scheduler = new AfeScheduler(movie, 12);
    const out: number[] = [];
    try {
      for await (const frame of scheduler.getFramesAt(times(8))) {
        expect(frame).not.toBeNull();
        out.push(frame!.timestamp);
        frame!.close();
      }
    } finally {
      const dump = scheduler.stallSnapshot({
        videoFramesRequested: 8,
        videoFramesDecoded: 8,
        videoFramesEncoded: 8,
      });
      expect(dump.unresolvedRequestedVideoFrames).toBe(0);
      expect(dump.openedRequestedVideoFrames).toBe(8);
      expect(dump.decoderResetForTransactionEnd).toBe(true);
      expect(dump.transactionComplete).toBe(true);
      expect(dump.stallPhase).toBe("TRANSACTION_END");
      expect(dump.decodeQueueBeforeCancel).not.toBeNull();
      expect(dump.decoderFlushCount).toBe(0);
      expect(isExportTransactionComplete(dump)).toBe(true);
      expect(
        requestedEncodedInvariantHolds({
          unresolvedRequestedVideoFrames: dump.unresolvedRequestedVideoFrames,
          videoFramesRequested: 8,
          videoFramesEncoded: 8,
        }),
      ).toBe(true);
      scheduler.close();
    }
    expect(out).toHaveLength(8);
  }, 10_000);

  it("unresolvedRequested>0 with Enc==Req is IMPOSSIBLE (invariant fails closed)", () => {
    expect(
      requestedEncodedInvariantHolds({
        unresolvedRequestedVideoFrames: 10,
        videoFramesRequested: 46,
        videoFramesEncoded: 46,
      }),
    ).toBe(false);
    expect(
      isTransactionComplete({
        unresolvedRequestedVideoFrames: 10,
        streamWaiterIndex: null,
        videoFramesRequested: 46,
        videoFramesDecoded: 46,
        videoFramesEncoded: 46,
      }),
    ).toBe(false);
    expect(
      isExportTransactionComplete({
        stallPhase: "TRANSACTION_END",
        sourceSampleRequested: 38,
        requestedPtsUs: 1_625_000,
        streamWaiterIndex: null,
        videoFramesRequested: 46,
        videoFramesDecoded: 46,
        videoFramesEncoded: 46,
        unresolvedRequestedVideoFrames: 10,
        decoderResetForTransactionEnd: false,
        transactionComplete: false,
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
        unresolvedRequestedVideoFrames: 0,
        videoFramesRequested: 46,
        videoFramesEncoded: 46,
      }),
    ).toBe(true);
  });

  it("lookahead-submitted planned samples are not unresolved until opened", async () => {
    const movie = loadMovie();
    if (!movie) return;
    restore = installHoldDecoder(0);
    const decoder = new AfeVideoDecoder(movie);
    await decoder.ensure();
    const lastRequired = lastRequiredDecodeSample({
      lastRequested: 12,
      maxReorderSamples: movie.maxReorderSamples,
      prefetch: 4,
      sampleCount: movie.sampleCount,
    });
    decoder.beginStream(new Uint8Array(13).fill(1), 0, {
      lastRequested: 12,
      lastRequiredDecodeSample: lastRequired,
      requestedIndexes: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
    });
    for (let i = 0; i <= Math.min(lastRequired, movie.sampleCount - 1); i++) {
      decoder.submitEncoded(movie.samples[i]!);
    }
    decoder.openRequested(0);
    expect(decoder.openedRequestedCount()).toBe(1);
    expect(decoder.unresolvedRequestedCount()).toBe(1);
    await new Promise((r) => setTimeout(r, 10));
    const frame = decoder.takeReady(0);
    expect(frame).not.toBeNull();
    frame!.close();
    expect(decoder.unresolvedRequestedCount()).toBe(0);
    expect(decoder.openedRequestedCount()).toBe(1);
    decoder.endStream();
    const dump = decoder.snapshot({
      videoFramesRequested: 1,
      videoFramesDecoded: 1,
      videoFramesEncoded: 1,
    });
    expect(dump.unresolvedRequestedVideoFrames).toBe(0);
    expect(dump.decoderResetForTransactionEnd).toBe(true);
    expect(dump.transactionComplete).toBe(true);
    expect(dump.cancelledSpeculativeSamples).toBeGreaterThan(0);
    decoder.close();
  }, 10_000);

  it("GOP resubmit of already-resolved samples does not reopen unresolved", async () => {
    const movie = loadMovie();
    if (!movie) return;
    restore = installHoldDecoder(0);
    const decoder = new AfeVideoDecoder(movie);
    await decoder.ensure();
    const requestedIndexes = [0, 1, 2, 3];
    const lastRequired = lastRequiredDecodeSample({
      lastRequested: 3,
      maxReorderSamples: movie.maxReorderSamples,
      prefetch: 4,
      sampleCount: movie.sampleCount,
    });
    decoder.beginStream(new Uint8Array([1, 1, 1, 1]), 0, {
      lastRequested: 3,
      lastRequiredDecodeSample: lastRequired,
      requestedIndexes,
    });
    for (let i = 0; i <= lastRequired && i < movie.sampleCount; i++) {
      decoder.submitEncoded(movie.samples[i]!);
    }
    await new Promise((r) => setTimeout(r, 10));
    for (let i = 0; i <= 3; i++) {
      const frame = decoder.takeReady(i);
      expect(frame).not.toBeNull();
      frame!.close();
    }
    expect(decoder.unresolvedRequestedCount()).toBe(0);
    decoder.beginStream(new Uint8Array([1, 1, 1, 1]), 0, {
      lastRequested: 3,
      lastRequiredDecodeSample: lastRequired,
      requestedIndexes,
      keepResolved: true,
    });
    for (let i = 0; i <= lastRequired && i < movie.sampleCount; i++) {
      decoder.submitEncoded(movie.samples[i]!);
    }
    expect(decoder.openedRequestedCount()).toBe(4);
    expect(decoder.unresolvedRequestedCount()).toBe(0);
    decoder.endStream();
    const dump = decoder.snapshot({
      videoFramesRequested: 4,
      videoFramesDecoded: 4,
      videoFramesEncoded: 4,
    });
    expect(dump.unresolvedRequestedVideoFrames).toBe(0);
    expect(dump.decoderResetForTransactionEnd).toBe(true);
    expect(dump.transactionComplete).toBe(true);
    expect(
      requestedEncodedInvariantHolds({
        unresolvedRequestedVideoFrames: dump.unresolvedRequestedVideoFrames,
        videoFramesRequested: 4,
        videoFramesEncoded: 4,
      }),
    ).toBe(true);
    decoder.close();
  }, 10_000);

  it("true missing exact PTS still stalls with origin sample/PTS and Enc < Req", async () => {
    const movie = loadMovie();
    if (!movie) return;
    const decoderProbe = new AfeVideoDecoder(movie);
    const missingPts = decoderProbe.chunkTimestampUs(movie.samples[3]!);
    decoderProbe.close();
    restore = installSkipPtsDecoder([missingPts]);
    const scheduler = new AfeScheduler(movie, 12);
    try {
      await expect(async () => {
        for await (const frame of scheduler.getFramesAt(times(6))) {
          frame?.close();
        }
      }).rejects.toMatchObject({ name: "AfeError", code: "AFE_DECODE_STALL" });
    } finally {
      const dump = scheduler.stallSnapshot({
        videoFramesRequested: 4,
        videoFramesDecoded: 3,
        videoFramesEncoded: 3,
      });
      expect(dump.originRequestedSample).toBe(3);
      expect(dump.originRequestedPts).toBe(missingPts);
      expect(dump.unresolvedRequestedVideoFrames).toBeGreaterThan(0);
      expect(dump.decoderResetForTransactionEnd).toBe(false);
      expect(dump.transactionComplete).toBe(false);
      expect(isExportTransactionComplete(dump)).toBe(false);
      expect(
        requestedEncodedInvariantHolds({
          unresolvedRequestedVideoFrames: dump.unresolvedRequestedVideoFrames,
          videoFramesRequested: 4,
          videoFramesEncoded: 3,
        }),
      ).toBe(true);
      const text = formatStallMessage(dump);
      expect(text).toContain("originSample 3");
      expect(text).toContain("(frame-count)");
      expect(text).toContain("(sample-index)");
      expect(text).not.toMatch(/nearest|snap|neighbor|paintFallback|allowSkip/i);
      scheduler.close();
    }
  }, 15_000);

  it("never-emitted opened sample keeps unresolved>0 and does not COMPLETE", async () => {
    const movie = loadMovie();
    if (!movie) return;
    restore = installNeverEmitDecoder();
    const decoder = new AfeVideoDecoder(movie);
    await decoder.ensure();
    decoder.beginStream(new Uint8Array([1, 1, 1, 1]), 0, {
      lastRequested: 3,
      lastRequiredDecodeSample: 8,
      requestedIndexes: [0, 1, 2, 3],
    });
    decoder.submitEncoded(movie.samples[0]!);
    decoder.openRequested(0);
    expect(decoder.unresolvedRequestedCount()).toBe(1);
    decoder.endStream();
    const dump = decoder.snapshot({
      videoFramesRequested: 1,
      videoFramesDecoded: 0,
      videoFramesEncoded: 0,
    });
    expect(dump.unresolvedRequestedVideoFrames).toBe(1);
    expect(dump.openedRequestedVideoFrames).toBe(1);
    expect(dump.decoderResetForTransactionEnd).toBe(false);
    expect(dump.transactionComplete).toBe(false);
    expect(dump.stallPhase).not.toBe("TRANSACTION_END");
    expect(
      requestedEncodedInvariantHolds({
        unresolvedRequestedVideoFrames: dump.unresolvedRequestedVideoFrames,
        videoFramesRequested: 1,
        videoFramesEncoded: 0,
      }),
    ).toBe(true);
    decoder.close();
  }, 10_000);

  it("dump distinguishes lastRequestedSample (index) from videoReq (frame-count)", () => {
    const text = formatStallMessage({
      lastRequestedSample: 81,
      lastRequiredDecodeSample: 87,
      videoFramesRequested: 46,
      videoFramesDecoded: 46,
      videoFramesEncoded: 46,
      openedRequestedVideoFrames: 47,
      unresolvedRequestedVideoFrames: 1,
      sourceSampleRequested: 38,
      requestedPtsUs: 1_625_000,
      originRequestedSample: 38,
      originRequestedPts: 1_625_000,
    });
    expect(text).toContain("videoReq 46 (frame-count)");
    expect(text).toContain("lastRequestedSample 81 (sample-index)");
    expect(text).toContain("openedRequested 47 (presentation asked)");
    expect(text).toContain("unresolvedRequested 1");
    expect(text).not.toMatch(/lastRequested 81(?! \(sample-index\))/);
  });
});
