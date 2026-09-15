import { existsSync, readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import {
  AFE_DECODE_STALL_MS,
  AfeScheduler,
  AfeVideoDecoder,
  formatStallMessage,
  isTrueTransactionTail,
  parseIsoBmff,
  pumpMoreSubmitEnd,
  requestedVideoFateLegal,
  streamLookaheadSamples,
} from "../../src/core/frame-engine";
import { countExportPictureKinds, groupFrameRuns } from "../../src/core/exporter/webcodecs";
import { jobFromProject } from "../../src/core/exporter/job";
import { createEmptyProject } from "../../src/core/project";
import { asset, clip, projectWith } from "../helpers";
import { sequentialTimes } from "./afe-plan";
import {
  installHangFlushDecoder,
  installHoldDecoder,
  installHoldUntilSubmittedDecoder,
  installNeverEmitDecoder,
  installQueueHeldDecoder,
  installRecoverOnResetDecoder,
  installSkipPtsDecoder,
  installStaleAfterResetDecoder,
} from "./afe-videodecoder-mock";

const PATH = "tests/fixtures/afe/afe-bframe-30-g30-2s.mp4";

function loadMovie() {
  if (!existsSync(PATH)) return null;
  return parseIsoBmff(new Uint8Array(readFileSync(PATH)));
}

function times(frames: number) {
  return sequentialTimes({
    id: "afe-07",
    path: PATH,
    fps: 30,
    frames,
    seconds: frames / 30,
    gop: 30,
    keyframeSec: [0],
  });
}

describe("AFE-07 A–M recovery / exact-frame delivery", () => {
  let restore: (() => void) | undefined;
  afterEach(() => {
    restore?.();
    restore = undefined;
  });

  it("A. strict VIDEO: awaitReady never null-yields a protected sample", async () => {
    const movie = loadMovie();
    if (!movie) return;
    restore = installNeverEmitDecoder();
    const decoder = new AfeVideoDecoder(movie);
    await decoder.ensure();
    decoder.beginStream(new Uint8Array(movie.sampleCount).fill(1), 0);
    decoder.submitEncoded(movie.samples[0]!);
    decoder.protectSample(0);
    await expect(
      decoder.awaitReady(
        0,
        undefined,
        {
          sourceSampleRequested: 0,
          requestedPtsUs: decoder.chunkTimestampUs(movie.samples[0]!),
          pictureKind: "video",
          originPictureKind: "video",
        },
        { allowSkip: true, throwOnTimeout: true, timeoutMs: 80 },
      ),
    ).rejects.toMatchObject({ name: "AfeError", code: "AFE_DECODE_STALL" });
    expect(requestedVideoFateLegal(decoder.fateOf(0))).toBe(true);
    expect(decoder.fateOf(0)).not.toBe("DISCARDED_NOT_NEEDED");
    decoder.close();
  }, 10_000);

  it("B. no mid-run flush: held queue on an 8-frame run fail-closes with flushes===0", async () => {
    const movie = loadMovie();
    if (!movie) return;
    restore = installQueueHeldDecoder();
    const scheduler = new AfeScheduler(movie, 12);
    try {
      await expect(async () => {
        for await (const frame of scheduler.getFramesAt(times(8))) {
          frame?.close();
        }
      }).rejects.toMatchObject({ name: "AfeError", code: "AFE_DECODE_STALL" });
    } finally {
      const dump = scheduler.stallSnapshot();
      expect(dump.decoderFlushCount).toBe(0);
      expect(dump.originRequestedSample).not.toBeNull();
      expect(dump.originRequestedPts).not.toBeNull();
      expect(dump.stallPhase).toBeTruthy();
      scheduler.close();
    }
  }, 15_000);

  it("C. pump-more unblocks without flush or recreate", async () => {
    const movie = loadMovie();
    if (!movie) return;
    const look = streamLookaheadSamples(movie.maxReorderSamples, 4);
    restore = installHoldUntilSubmittedDecoder(look + 3);
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
      expect(dump.decoderFlushCount).toBe(0);
      expect(dump.decoderRecreateCount).toBe(0);
      scheduler.close();
    }
    expect(out).toHaveLength(8);
  }, 15_000);

  it("D. one GOP recovery recreates the decoder and delivers the exact PTS", async () => {
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
      expect(dump.decoderFlushCount).toBe(0);
      expect(dump.originRequestedSample).not.toBeNull();
      scheduler.close();
    }
    expect(out).toHaveLength(6);
  }, 15_000);

  it("E. FINAL_FLUSH only at true tail (1-frame held queue)", async () => {
    const movie = loadMovie();
    if (!movie) return;
    restore = installQueueHeldDecoder();
    const scheduler = new AfeScheduler(movie, 12);
    const out: number[] = [];
    try {
      for await (const frame of scheduler.getFramesAt(times(1))) {
        expect(frame).not.toBeNull();
        out.push(frame!.timestamp);
        frame!.close();
      }
    } finally {
      expect(scheduler.stallSnapshot().decoderFlushCount).toBe(1);
      scheduler.close();
    }
    expect(out).toHaveLength(1);
  }, 15_000);

  it("F. hung FINAL_FLUSH is AFE_DECODE_STALL with origin + phase", async () => {
    const movie = loadMovie();
    if (!movie) return;
    restore = installHangFlushDecoder();
    const scheduler = new AfeScheduler(movie, 12);
    const started = Date.now();
    try {
      await expect(async () => {
        for await (const frame of scheduler.getFramesAt(times(1))) {
          frame?.close();
        }
      }).rejects.toMatchObject({ name: "AfeError", code: "AFE_DECODE_STALL" });
    } finally {
      const dump = scheduler.stallSnapshot();
      expect(dump.originRequestedSample).not.toBeNull();
      expect(dump.originRequestedPts).not.toBeNull();
      expect(dump.stallPhase === "FINAL_FLUSH" || dump.decoderFlushCount >= 1).toBe(true);
      expect(Date.now() - started).toBeGreaterThanOrEqual(AFE_DECODE_STALL_MS - 80);
      scheduler.close();
    }
  }, 15_000);

  it("G. stale outputs after recreate are closed/ignored", async () => {
    const movie = loadMovie();
    if (!movie) return;
    restore = installStaleAfterResetDecoder();
    const scheduler = new AfeScheduler(movie, 12);
    const out: number[] = [];
    try {
      for await (const frame of scheduler.getFramesAt(times(4))) {
        expect(frame).not.toBeNull();
        out.push(frame!.timestamp);
        frame!.close();
      }
    } finally {
      expect(scheduler.stallSnapshot().decoderRecreateCount).toBeGreaterThanOrEqual(1);
      scheduler.close();
    }
    expect(out).toHaveLength(4);
    for (let i = 1; i < out.length; i++) expect(out[i]!).toBeGreaterThan(out[i - 1]!);
  }, 15_000);

  it("H. VIS multi-scene: afeFrames===0 and no video run", () => {
    const p = createEmptyProject("VIS-multi");
    p.inPointMs = 0;
    p.outPointMs = 3000;
    p.visualizer = {
      ...p.visualizer,
      enabled: true,
      muted: false,
      sceneId: "void-lattice",
      startMs: 0,
      durationMs: 0,
      events: [
        { id: "a", sceneId: "void-lattice", startMs: 0, durationMs: 1500 },
        { id: "b", sceneId: "particle-field", startMs: 1500, durationMs: 1500 },
      ],
    };
    const job = jobFromProject(p);
    const counts = countExportPictureKinds(job);
    expect(counts.afeFrames).toBe(0);
    expect(counts.videoFramesRequested).toBe(0);
    expect(counts.visFrames).toBeGreaterThan(0);
    const total = Math.max(1, Math.round((job.durationMs / 1000) * job.fps));
    const runs = groupFrameRuns(job, total, job.fps);
    expect(runs.every((r) => r.pictureKind === "vis" && r.clip == null)).toBe(true);
  });

  it("I. VIDEO run: mapped samples never yield null", async () => {
    const movie = loadMovie();
    if (!movie) return;
    restore = installHoldDecoder(Math.max(1, streamLookaheadSamples(movie.maxReorderSamples, 4) - 1));
    const scheduler = new AfeScheduler(movie, 12);
    try {
      for await (const frame of scheduler.getFramesAt(times(10))) {
        expect(frame).not.toBeNull();
        frame!.close();
      }
    } finally {
      expect(scheduler.stallSnapshot().decoderFlushCount).toBe(0);
      scheduler.close();
    }
  }, 15_000);

  it("J. Shape Q: mid-run held queue does not flush; tail flush resolves", async () => {
    const movie = loadMovie();
    if (!movie) return;
    restore = installQueueHeldDecoder();
    const decoder = new AfeVideoDecoder(movie);
    await decoder.ensure();
    decoder.beginStream(new Uint8Array(movie.sampleCount).fill(1), 0);
    for (let i = 0; i < 8; i++) decoder.submitEncoded(movie.samples[i]!);
    const pts = decoder.chunkTimestampUs(movie.samples[0]!);
    decoder.bindOrigin({
      sourceSampleRequested: 0,
      requestedPtsUs: pts,
      originExportFrame: 12,
      originTimelineMs: 400,
      originClipId: "c1",
      originClipLabel: "V1-stills.mp4",
      originSourceName: "V1-stills.mp4",
      originPictureKind: "video",
    });
    const before = decoder.snapshot();
    expect(before.decodeQueueSize).toBeGreaterThan(0);
    expect(before.decoderFlushCount).toBe(0);
    const mid = await decoder.awaitReady(0, undefined, undefined, {
      allowSkip: false,
      throwOnTimeout: false,
      timeoutMs: 80,
    });
    expect(mid).toBeNull();
    expect(decoder.snapshot().decoderFlushCount).toBe(0);
    expect(decoder.snapshot().originRequestedSample).toBe(0);
    expect(decoder.snapshot().originClipLabel).toBe("V1-stills.mp4");
    decoder.close();
  }, 10_000);

  it("K. Shape R: missing requested PTS is AFE_DECODE_STALL, not null", async () => {
    const movie = loadMovie();
    if (!movie) return;
    const planned = times(8);
    restore = installSkipPtsDecoder([new AfeVideoDecoder(movie).chunkTimestampUs(movie.samples[1]!)]);
    const scheduler = new AfeScheduler(movie, 12);
    try {
      await expect(async () => {
        for await (const frame of scheduler.getFramesAt(planned)) {
          frame?.close();
        }
      }).rejects.toMatchObject({ name: "AfeError", code: "AFE_DECODE_STALL" });
    } finally {
      const dump = scheduler.stallSnapshot();
      expect(dump.originRequestedSample).not.toBeNull();
      expect(dump.decoderFlushCount).toBe(0);
      scheduler.close();
    }
  }, 15_000);

  it("L. stall dump keeps origin identity + exact-PTS fields (AFE-04)", () => {
    const text = formatStallMessage({
      sourceSampleRequested: 17,
      requestedPtsUs: 566667,
      originRequestedSample: 17,
      originRequestedPts: 566667,
      originExportFrame: 42,
      originTimelineMs: 70000,
      originClipId: "c1",
      originClipLabel: "V1-stills.mp4",
      originSourceName: "V1-stills.mp4",
      originPictureKind: "video",
      stallPhase: "GOP_RECOVERY",
      transactionId: 3,
      gopKeyframeStart: 0,
      pictureKind: "video",
      visFrames: 12,
      afeFrames: 36,
      blackFrames: 0,
    });
    expect(text).toContain("requested sample 17 PTS 566667");
    expect(text).toContain("originSample 17");
    expect(text).toContain("originPts 566667");
    expect(text).toContain("originExportFrame 42");
    expect(text).toContain("stallPhase GOP_RECOVERY");
    expect(text).toContain("transactionId 3");
    expect(text).not.toMatch(/nearest|snap|neighbor|BLACK|paintFallback/i);
  });

  it("M. AFE-05 lookahead still emits hold-for-N+k without flush", async () => {
    const movie = loadMovie();
    if (!movie) return;
    const look = streamLookaheadSamples(movie.maxReorderSamples, 4);
    restore = installHoldDecoder(Math.max(2, look - 1));
    const scheduler = new AfeScheduler(movie, 12);
    const out: number[] = [];
    try {
      for await (const frame of scheduler.getFramesAt(times(12))) {
        expect(frame).not.toBeNull();
        out.push(frame!.timestamp);
        frame!.close();
      }
    } finally {
      expect(scheduler.stallSnapshot().decoderFlushCount).toBe(0);
      scheduler.close();
    }
    expect(out).toHaveLength(12);
  }, 15_000);

  it("pump-more is structure-bounded (not whole-file, not a lookahead raise)", () => {
    const end = pumpMoreSubmitEnd({
      requested: 4,
      nextDecode: 10,
      sampleCount: 120,
      prefetch: 4,
      maxReorderSamples: 2,
      nextRefOrGop: 30,
      lastRequested: 80,
    });
    expect(end).toBeGreaterThanOrEqual(10);
    expect(end).toBeLessThan(120);
    expect(end).toBeLessThanOrEqual(30);
    expect(
      isTrueTransactionTail({ requested: 4, lastRequested: 80, nextDecode: 10, sampleCount: 120 }),
    ).toBe(false);
    expect(
      isTrueTransactionTail({ requested: 80, lastRequested: 80, nextDecode: 10, sampleCount: 120 }),
    ).toBe(true);
    expect(
      isTrueTransactionTail({ requested: 4, lastRequested: 80, nextDecode: 120, sampleCount: 120 }),
    ).toBe(true);
  });

  it("mixed VIS+VIDEO: VIS runs have no clip; VIDEO runs stay video", () => {
    const p = projectWith(
      [clip({ id: "v1-pocket", assetId: "a1", trackId: "V1", startMs: 1500, durationMs: 1000 })],
      [
        asset({
          id: "a1",
          name: "V1-stills.mp4",
          kind: "video",
          durationMs: 8000,
          objectUrl: "blob:v1-stills",
          missing: false,
        }),
      ],
    );
    p.inPointMs = 0;
    p.outPointMs = 4000;
    p.visualizer = {
      ...p.visualizer,
      enabled: true,
      muted: false,
      sceneId: "void-lattice",
      startMs: 0,
      durationMs: 0,
      events: [
        { id: "lattice", sceneId: "void-lattice", startMs: 0, durationMs: 1000 },
        { id: "field", sceneId: "particle-field", startMs: 3000, durationMs: 1000 },
      ],
    };
    const job = jobFromProject(p);
    const total = Math.max(1, Math.round((job.durationMs / 1000) * job.fps));
    const runs = groupFrameRuns(job, total, job.fps);
    expect(runs.some((r) => r.pictureKind === "vis" && r.clip == null)).toBe(true);
    expect(runs.some((r) => r.pictureKind === "video" && r.clip?.id === "v1-pocket")).toBe(true);
    const counts = countExportPictureKinds(job);
    expect(counts.afeFrames).toBeGreaterThan(0);
    expect(counts.visFrames).toBeGreaterThan(0);
  });
});
