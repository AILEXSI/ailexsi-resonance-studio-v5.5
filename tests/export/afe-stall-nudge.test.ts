import { existsSync, readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import {
  AfeError,
  AfeScheduler,
  AfeVideoDecoder,
  parseIsoBmff,
  planSampleIndexes,
} from "../../src/core/frame-engine";
import { sequentialTimes } from "./afe-plan";
import {
  installNeverEmitDecoder,
  installQueueHeldDecoder,
  installSkipPtsDecoder,
} from "./afe-videodecoder-mock";

const PATH = "tests/fixtures/afe/afe-bframe-30-g30-2s.mp4";

function loadMovie() {
  if (!existsSync(PATH)) return null;
  return parseIsoBmff(new Uint8Array(readFileSync(PATH)));
}

describe("AFE-06 stall nudge + honest picture counts", () => {
  let restore: (() => void) | undefined;
  afterEach(() => {
    restore?.();
    restore = undefined;
  });

  it("Shape Q: pending contains requested, queue>0, flush 0→1, frame resolves", async () => {
    const movie = loadMovie();
    if (!movie) return;
    restore = installQueueHeldDecoder();
    const decoder = new AfeVideoDecoder(movie);
    await decoder.ensure();
    const needed = new Uint8Array(movie.sampleCount).fill(1);
    decoder.beginStream(needed, 0);
    for (let i = 0; i < 8; i++) decoder.submitEncoded(movie.samples[i]!);
    const pts = decoder.chunkTimestampUs(movie.samples[0]!);
    const before = decoder.snapshot({ requestedPtsUs: pts, sourceSampleRequested: 0 });
    expect(before.pendingPts).toContain(pts);
    expect(before.decodeQueueSize).toBeGreaterThan(0);
    expect(before.readyIndexes).toEqual([]);
    expect(before.decoderFlushCount).toBe(0);

    const frame = await decoder.awaitReady(0, undefined, {
      requestedPtsUs: pts,
      sourceSampleRequested: 0,
    });
    expect(frame).not.toBeNull();
    expect(decoder.snapshot().decoderFlushCount).toBe(1);
    frame!.close();
    decoder.close();
  }, 10_000);

  it("Shape R: neighbors ready, requested missing, nudge then null-yield; later frames continue", async () => {
    const movie = loadMovie();
    if (!movie) return;
    const times = sequentialTimes({
      id: "shape-r",
      path: PATH,
      fps: 30,
      frames: 10,
      seconds: 10 / 30,
      gop: 30,
      keyframeSec: [0],
    });
    const planned = planSampleIndexes(movie, times);
    const skipAt = planned.findIndex((idx, i) => i > 0 && idx != null);
    const skipSample = planned[skipAt];
    expect(skipSample).toEqual(expect.any(Number));
    const skipPts = new AfeVideoDecoder(movie).chunkTimestampUs(movie.samples[skipSample!]!);
    restore = installSkipPtsDecoder([skipPts]);
    const scheduler = new AfeScheduler(movie, 12);
    const out: Array<number | null> = [];
    try {
      for await (const frame of scheduler.getFramesAt(times)) {
        out.push(frame ? frame.timestamp : null);
        frame?.close();
      }
    } finally {
      scheduler.close();
    }
    expect(out).toHaveLength(10);
    expect(out[skipAt]).toBeNull();
    expect(out.filter((t) => t != null).length).toBe(9);
    for (let i = 1; i < out.length; i++) {
      if (out[i] == null || out[i - 1] == null) continue;
      expect(out[i]!).toBeGreaterThan(out[i - 1]!);
    }
  }, 15_000);

  it("fail-closed AFE_DECODE_STALL after nudge when nothing emits (flushes ≥ 1)", async () => {
    const movie = loadMovie();
    if (!movie) return;
    restore = installNeverEmitDecoder();
    const scheduler = new AfeScheduler(movie, 12);
    const times = sequentialTimes({
      id: "never",
      path: PATH,
      fps: 30,
      frames: 6,
      seconds: 6 / 30,
      gop: 30,
      keyframeSec: [0],
    });
    try {
      await expect(async () => {
        for await (const frame of scheduler.getFramesAt(times)) {
          frame?.close();
        }
      }).rejects.toMatchObject({ name: "AfeError", code: "AFE_DECODE_STALL" });
    } finally {
      const dump = scheduler.stallSnapshot();
      expect(dump.decoderFlushCount).toBeGreaterThanOrEqual(1);
      scheduler.close();
    }
  }, 15_000);

});
