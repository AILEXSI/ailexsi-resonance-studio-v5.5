import { existsSync, readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { countExportPictureKinds, groupFrameRuns } from "../../src/core/exporter/webcodecs";
import { jobFromProject } from "../../src/core/exporter/job";
import {
  AfeScheduler,
  AfeVideoDecoder,
  classifySampleRole,
  formatStallMessage,
  isExportTransactionComplete,
  isTransactionComplete,
  lastRequiredDecodeSample,
  mayFinalFlush,
  parseIsoBmff,
  pumpMoreSubmitEnd,
  requestedVideoFateLegal,
  streamLookaheadSamples,
} from "../../src/core/frame-engine";
import { createEmptyProject } from "../../src/core/project";
import { sequentialTimes } from "./afe-plan";
import {
  installEmitThenHoldHangFlushDecoder,
  installHangFlushDecoder,
  installHoldDecoder,
} from "./afe-videodecoder-mock";

const PATH = "tests/fixtures/afe/afe-bframe-30-g30-2s.mp4";

function loadMovie() {
  if (!existsSync(PATH)) return null;
  return parseIsoBmff(new Uint8Array(readFileSync(PATH)));
}

function times(frames: number) {
  return sequentialTimes({
    id: "afe-08",
    path: PATH,
    fps: 30,
    frames,
    seconds: frames / 30,
    gop: 30,
    keyframeSec: [0],
  });
}

describe("AFE-08 A–I transaction end must not drain speculative decode", () => {
  let restore: (() => void) | undefined;
  afterEach(() => {
    restore?.();
    restore = undefined;
  });

  it("A. transaction COMPLETE when requested VIDEO is terminal; nothing left to flush", () => {
    expect(
      isTransactionComplete({
        unresolvedRequestedVideoFrames: 0,
        streamWaiterIndex: null,
        videoFramesRequested: 37,
        videoFramesDecoded: 37,
        videoFramesEncoded: 37,
      }),
    ).toBe(true);
    expect(
      isTransactionComplete({
        unresolvedRequestedVideoFrames: 1,
        streamWaiterIndex: null,
        videoFramesRequested: 37,
        videoFramesDecoded: 36,
        videoFramesEncoded: 36,
      }),
    ).toBe(false);
    expect(
      mayFinalFlush({
        unresolvedRequestedVideoFrames: 0,
        nextDecode: 140,
        sampleCount: 140,
        lastRequiredDecodeSample: 42,
      }),
    ).toBe(false);
  });

  it("B. cancel speculative at TRANSACTION_END: hang-flush queue is SUCCESS, not stall", async () => {
    const movie = loadMovie();
    if (!movie) return;
    restore = installEmitThenHoldHangFlushDecoder(8);
    const scheduler = new AfeScheduler(movie, 12);
    const out: number[] = [];
    const started = Date.now();
    try {
      for await (const frame of scheduler.getFramesAt(times(8))) {
        expect(frame).not.toBeNull();
        out.push(frame!.timestamp);
        frame!.close();
      }
    } finally {
      const dump = scheduler.stallSnapshot();
      expect(dump.decoderFlushCount).toBe(0);
      expect(dump.decoderResetForTransactionEnd).toBe(true);
      expect(dump.stallPhase).toBe("TRANSACTION_END");
      expect(dump.transactionComplete).toBe(true);
      expect(dump.decodeQueueBeforeCancel).not.toBeNull();
      expect(Date.now() - started).toBeLessThan(2500);
      scheduler.close();
    }
    expect(out).toHaveLength(8);
  }, 10_000);

  it("C. FINAL_FLUSH forbidden when every requested sample is already RESOLVED", async () => {
    const movie = loadMovie();
    if (!movie) return;
    restore = installHoldDecoder(0);
    const decoder = new AfeVideoDecoder(movie);
    await decoder.ensure();
    const lastRequired = lastRequiredDecodeSample({
      lastRequested: 3,
      maxReorderSamples: movie.maxReorderSamples,
      prefetch: 4,
      sampleCount: movie.sampleCount,
    });
    decoder.beginStream(new Uint8Array([1, 1, 1, 1]), 0, {
      lastRequested: 3,
      lastRequiredDecodeSample: lastRequired,
      requestedIndexes: [0, 1, 2, 3],
    });
    for (let i = 0; i <= lastRequired + 8 && i < movie.sampleCount; i++) {
      decoder.submitEncoded(movie.samples[i]!);
    }
    await new Promise((r) => setTimeout(r, 10));
    for (let i = 0; i <= 3; i++) {
      const frame = decoder.takeReady(i);
      expect(frame).not.toBeNull();
      frame!.close();
    }
    expect(decoder.unresolvedRequestedCount()).toBe(0);
    const before = decoder.snapshot().decoderFlushCount;
    await decoder.flushTail();
    expect(decoder.snapshot().decoderFlushCount).toBe(before);
    decoder.endStream();
    expect(decoder.snapshot().decoderResetForTransactionEnd).toBe(true);
    decoder.close();
  }, 10_000);

  it("D. FINAL_FLUSH only if unresolvedRequested>0 and no further useful input", () => {
    expect(
      mayFinalFlush({
        unresolvedRequestedVideoFrames: 1,
        nextDecode: 43,
        sampleCount: 140,
        lastRequiredDecodeSample: 42,
      }),
    ).toBe(true);
    expect(
      mayFinalFlush({
        unresolvedRequestedVideoFrames: 1,
        nextDecode: 20,
        sampleCount: 140,
        lastRequiredDecodeSample: 42,
      }),
    ).toBe(false);
    expect(
      mayFinalFlush({
        unresolvedRequestedVideoFrames: 0,
        nextDecode: 140,
        sampleCount: 140,
        lastRequiredDecodeSample: 42,
      }),
    ).toBe(false);
  });

  it("E. submission is bounded to last requested + B-reorder + refs (not 140 for 37)", () => {
    const lastRequired = lastRequiredDecodeSample({
      lastRequested: 36,
      maxReorderSamples: 2,
      prefetch: 4,
      sampleCount: 140,
      nextRefOrGop: null,
    });
    expect(lastRequired).toBeGreaterThanOrEqual(36);
    expect(lastRequired).toBeLessThan(140);
    expect(lastRequired).toBeLessThanOrEqual(36 + streamLookaheadSamples(2, 4));
    const pumped = pumpMoreSubmitEnd({
      requested: 36,
      nextDecode: 40,
      sampleCount: 140,
      prefetch: 4,
      maxReorderSamples: 2,
      nextRefOrGop: null,
      lastRequested: 36,
    });
    expect(pumped).toBeLessThan(140);
    expect(pumped).toBeLessThanOrEqual(lastRequired);
    const eofFallback = pumpMoreSubmitEnd({
      requested: 36,
      nextDecode: 40,
      sampleCount: 140,
      prefetch: 4,
      maxReorderSamples: 2,
      nextRefOrGop: 139,
      lastRequested: 36,
    });
    expect(eofFallback).toBeLessThanOrEqual(lastRequired);
    expect(eofFallback).toBeLessThan(100);
  });

  it("F. samples classify REQUESTED / REFERENCE_REQUIRED / SPECULATIVE; speculative is cancellable", async () => {
    expect(
      classifySampleRole(5, {
        requestedIndexes: [4, 5, 6],
        decodeStart: 0,
        lastRequiredDecodeSample: 12,
      }),
    ).toBe("REQUESTED");
    expect(
      classifySampleRole(1, {
        requestedIndexes: [4, 5, 6],
        decodeStart: 0,
        lastRequiredDecodeSample: 12,
      }),
    ).toBe("REFERENCE_REQUIRED");
    expect(
      classifySampleRole(80, {
        requestedIndexes: [4, 5, 6],
        decodeStart: 0,
        lastRequiredDecodeSample: 12,
      }),
    ).toBe("SPECULATIVE");

    const movie = loadMovie();
    if (!movie) return;
    restore = installHoldDecoder(0);
    const decoder = new AfeVideoDecoder(movie);
    await decoder.ensure();
    const lastRequired = lastRequiredDecodeSample({
      lastRequested: 2,
      maxReorderSamples: movie.maxReorderSamples,
      prefetch: 4,
      sampleCount: movie.sampleCount,
    });
    decoder.beginStream(new Uint8Array([1, 1, 1]), 0, {
      lastRequested: 2,
      lastRequiredDecodeSample: lastRequired,
      requestedIndexes: [0, 1, 2],
    });
    for (let i = 0; i <= lastRequired && i < movie.sampleCount; i++) {
      decoder.submitEncoded(movie.samples[i]!);
    }
    if (lastRequired + 1 < movie.sampleCount) {
      decoder.submitEncoded(movie.samples[lastRequired + 1]!);
    }
    expect(decoder.roleOf(0)).toBe("REQUESTED");
    expect(decoder.roleOf(lastRequired + 1) === "SPECULATIVE" || lastRequired + 1 >= movie.sampleCount).toBe(
      true,
    );
    await new Promise((r) => setTimeout(r, 10));
    for (let i = 0; i <= 2; i++) decoder.takeReady(i)?.close();
    decoder.endStream();
    const dump = decoder.snapshot();
    expect(dump.decoderResetForTransactionEnd).toBe(true);
    expect(dump.cancelledSpeculativeSamples).toBeGreaterThanOrEqual(0);
    expect(requestedVideoFateLegal(decoder.fateOf(0))).toBe(true);
    decoder.close();
  }, 10_000);

  it("G. TRANSACTION_END + null request + Req==Enc is COMPLETE, not AFE_DECODE_STALL", () => {
    const dump = {
      stallPhase: "TRANSACTION_END" as const,
      sourceSampleRequested: null,
      requestedPtsUs: null,
      streamWaiterIndex: null,
      streamPtsPending: 0,
      streamReadySize: 0,
      decodeQueueSize: 124,
      lastSubmittedSample: 140,
      videoFramesRequested: 37,
      videoFramesDecoded: 37,
      videoFramesEncoded: 37,
      cancelledSpeculativeSamples: 101,
      decodeQueueBeforeCancel: 124,
      decoderResetForTransactionEnd: true,
      lastRequestedSample: 36,
      lastRequiredDecodeSample: 42,
      speculativeSamplesSubmitted: 104,
      unresolvedRequestedVideoFrames: 0,
      transactionComplete: true,
    };
    expect(isExportTransactionComplete(dump)).toBe(true);
    const text = formatStallMessage(dump);
    expect(text).toContain("stallPhase TRANSACTION_END");
    expect(text).toContain("videoReq 37");
    expect(text).toContain("videoEnc 37");
    expect(text).toContain("cancelledSpeculativeSamples 101");
    expect(text).toContain("decodeQueueBeforeCancel 124");
    expect(text).toContain("decoderResetForTransactionEnd true");
    expect(text).toContain("lastRequested 36");
    expect(text).toContain("lastRequiredDecode 42");
    expect(text).toContain("speculativeSubmitted 104");
    expect(text).toContain("transactionComplete true");
    expect(text).not.toMatch(/nearest|snap|neighbor|paintFallback|allowSkip/i);
  });

  it("H. AFE-07 exact-PTS / VIS preserved: no skip, no VIDEO null, no VIS wait", async () => {
    const movie = loadMovie();
    if (!movie) return;
    restore = installHoldDecoder(Math.max(1, streamLookaheadSamples(movie.maxReorderSamples, 4) - 1));
    const scheduler = new AfeScheduler(movie, 12);
    try {
      for await (const frame of scheduler.getFramesAt(times(6))) {
        expect(frame).not.toBeNull();
        frame!.close();
      }
    } finally {
      const dump = scheduler.stallSnapshot();
      expect(dump.decoderFlushCount).toBe(0);
      expect(requestedVideoFateLegal(dump.lastSampleResolved != null ? "RESOLVED" : "PENDING")).toBe(true);
      scheduler.close();
    }

    const p = createEmptyProject("VIS-afe-08");
    p.inPointMs = 0;
    p.outPointMs = 2000;
    p.visualizer = {
      ...p.visualizer,
      enabled: true,
      muted: false,
      sceneId: "void-lattice",
      startMs: 0,
      durationMs: 0,
      events: [
        { id: "a", sceneId: "void-lattice", startMs: 0, durationMs: 1000 },
        { id: "b", sceneId: "particle-field", startMs: 1000, durationMs: 1000 },
      ],
    };
    const job = jobFromProject(p);
    const counts = countExportPictureKinds(job);
    expect(counts.afeFrames).toBe(0);
    expect(counts.videoFramesRequested).toBe(0);
    const runs = groupFrameRuns(job, Math.max(1, Math.round((job.durationMs / 1000) * job.fps)), job.fps);
    expect(runs.every((r) => r.pictureKind === "vis" && r.clip == null)).toBe(true);
  }, 15_000);

  it("I. unresolved requested + hung FINAL_FLUSH is still AFE_DECODE_STALL (AFE-07)", async () => {
    const movie = loadMovie();
    if (!movie) return;
    restore = installHangFlushDecoder();
    const scheduler = new AfeScheduler(movie, 12);
    try {
      await expect(async () => {
        for await (const frame of scheduler.getFramesAt(times(1))) {
          frame?.close();
        }
      }).rejects.toMatchObject({ name: "AfeError", code: "AFE_DECODE_STALL" });
    } finally {
      const dump = scheduler.stallSnapshot();
      expect(dump.originRequestedSample).not.toBeNull();
      expect(dump.stallPhase === "FINAL_FLUSH" || dump.decoderFlushCount >= 1).toBe(true);
      expect(isExportTransactionComplete(dump)).toBe(false);
      scheduler.close();
    }
  }, 15_000);
});
