import { existsSync, readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import {
  AFE_DECODE_STALL_MS,
  AfeError,
  AfeScheduler,
  parseIsoBmff,
  streamLookaheadSamples,
} from "../../src/core/frame-engine";
import { sequentialTimes } from "./afe-plan";
import { installHoldDecoder } from "./afe-videodecoder-mock";

const PATH = "tests/fixtures/afe/afe-bframe-30-g30-2s.mp4";

function loadMovie() {
  if (!existsSync(PATH)) return null;
  return parseIsoBmff(new Uint8Array(readFileSync(PATH)));
}

describe("AFE-05 stall watchdog + B-frame wait abort", () => {
  let restore: (() => void) | undefined;
  afterEach(() => {
    restore?.();
    restore = undefined;
  });

  it("submits future decode-order samples so a hold-for-N+k decoder emits without stall", async () => {
    const movie = loadMovie();
    if (!movie) return;
    const look = streamLookaheadSamples(movie.maxReorderSamples, 4);
    restore = installHoldDecoder(Math.max(2, look - 1));
    const scheduler = new AfeScheduler(movie, 12);
    const times = sequentialTimes({
      id: "hold",
      path: PATH,
      fps: 30,
      frames: 12,
      seconds: 12 / 30,
      gop: 30,
      keyframeSec: [0],
    });
    const out: number[] = [];
    try {
      for await (const frame of scheduler.getFramesAt(times)) {
        expect(frame).not.toBeNull();
        out.push(frame!.timestamp);
        frame!.close();
      }
    } finally {
      scheduler.close();
    }
    expect(out).toHaveLength(12);
    for (let i = 1; i < out.length; i++) expect(out[i]!).toBeGreaterThan(out[i - 1]!);
  }, 15_000);

  it("fail-closed AFE_DECODE_STALL when decoder needs more than lookahead (no silent hang)", async () => {
    const movie = loadMovie();
    if (!movie) return;
    restore = installHoldDecoder(40);
    const scheduler = new AfeScheduler(movie, 12);
    const times = sequentialTimes({
      id: "stall",
      path: PATH,
      fps: 30,
      frames: 8,
      seconds: 8 / 30,
      gop: 30,
      keyframeSec: [0],
    });
    const started = Date.now();
    try {
      await expect(async () => {
        for await (const frame of scheduler.getFramesAt(times)) {
          frame?.close();
        }
      }).rejects.toMatchObject({ name: "AfeError", code: "AFE_DECODE_STALL" });
    } finally {
      scheduler.close();
    }
    expect(Date.now() - started).toBeGreaterThanOrEqual(AFE_DECODE_STALL_MS - 50);
    expect(Date.now() - started).toBeLessThan(AFE_DECODE_STALL_MS + 2000);
  }, 15_000);

  it("abort during B-frame wait rejects waiters, resets decoder, and leaves no zombie ready frames", async () => {
    const movie = loadMovie();
    if (!movie) return;
    restore = installHoldDecoder(40);
    const scheduler = new AfeScheduler(movie, 12);
    const ac = new AbortController();
    const times = sequentialTimes({
      id: "abort",
      path: PATH,
      fps: 30,
      frames: 8,
      seconds: 8 / 30,
      gop: 30,
      keyframeSec: [0],
    });
    const run = (async () => {
      for await (const frame of scheduler.getFramesAt(times, ac.signal)) {
        frame?.close();
      }
    })();
    await new Promise((r) => setTimeout(r, 40));
    ac.abort();
    await expect(run).rejects.toMatchObject({ name: "AfeError", code: "AFE_ABORTED", fallbackSafe: false });
    expect(scheduler.memoryStats().decodedCached).toBe(0);
    scheduler.close();
    await expect(scheduler.getFrameAt(0)).rejects.toBeInstanceOf(AfeError);
  }, 10_000);
});
