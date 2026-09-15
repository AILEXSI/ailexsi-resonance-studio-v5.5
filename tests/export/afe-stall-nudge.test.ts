import { existsSync, readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import {
  AfeError,
  AfeScheduler,
  AfeVideoDecoder,
  parseIsoBmff,
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

describe("AFE-07 (was AFE-06 nudge): no mid-run flush + honest picture", () => {
  let restore: (() => void) | undefined;
  afterEach(() => {
    restore?.();
    restore = undefined;
  });

  it("Shape Q: pending contains requested, queue>0, awaitReady does not flush", async () => {
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

    const frame = await decoder.awaitReady(
      0,
      undefined,
      {
        requestedPtsUs: pts,
        sourceSampleRequested: 0,
      },
      { throwOnTimeout: false, timeoutMs: 80, allowSkip: false },
    );
    expect(frame).toBeNull();
    expect(decoder.snapshot().decoderFlushCount).toBe(0);
    expect(decoder.snapshot().originRequestedSample).toBe(0);
    decoder.close();
  }, 10_000);

  it("Shape R: missing requested PTS fail-closes; no silent null-yield", async () => {
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
    const skipPts = new AfeVideoDecoder(movie).chunkTimestampUs(movie.samples[1]!);
    restore = installSkipPtsDecoder([skipPts]);
    const scheduler = new AfeScheduler(movie, 12);
    try {
      await expect(async () => {
        for await (const frame of scheduler.getFramesAt(times)) {
          frame?.close();
        }
      }).rejects.toMatchObject({ name: "AfeError", code: "AFE_DECODE_STALL" });
    } finally {
      expect(scheduler.stallSnapshot().originRequestedSample).not.toBeNull();
      scheduler.close();
    }
  }, 15_000);

  it("fail-closed AFE_DECODE_STALL when nothing emits (no mid-run flush required)", async () => {
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
      expect(dump.finalFlushAttempted).toBe(true);
      expect(dump.decoderFlushCount).toBeGreaterThanOrEqual(1);
      expect(dump.transactionComplete).toBe(false);
      scheduler.close();
    }
  }, 15_000);
});
