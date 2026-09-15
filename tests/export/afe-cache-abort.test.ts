import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  AfeError,
  AfeScheduler,
  DecodedFrameCache,
  parseIsoBmff,
} from "../../src/core/frame-engine";

describe("AFE bounded cache + AbortSignal", () => {
  it("cache evicts closed frames and reports a stable max", () => {
    const cache = new DecodedFrameCache(3);
    const closed: number[] = [];
    const fake = (id: number): VideoFrame =>
      ({
        codedWidth: 16,
        codedHeight: 9,
        close: () => {
          closed.push(id);
        },
        clone: () => fake(id + 100),
      }) as unknown as VideoFrame;
    cache.put(0, fake(0));
    cache.put(1, fake(1));
    cache.put(2, fake(2));
    cache.put(3, fake(3));
    const stats = cache.stats();
    expect(stats.decodedCached).toBe(3);
    expect(stats.maxDecodedCached).toBe(3);
    expect(stats.peakDecodedCached).toBe(3);
    expect(stats.approxBytes).toBe(3 * 16 * 9 * 4);
    expect(closed).toContain(0);
    cache.clear();
    expect(cache.stats().decodedCached).toBe(0);
    expect(cache.stats().peakDecodedCached).toBe(3);
  });

  it("aborted signal stops getFrameAt before decode and does not leave waiters", async () => {
    const bytes = new Uint8Array(readFileSync("tests/fixtures/afe/afe-cfr-30-g30-2s.mp4"));
    const movie = parseIsoBmff(bytes);
    const scheduler = new AfeScheduler(movie, 4);
    const ac = new AbortController();
    ac.abort();
    await expect(scheduler.getFrameAt(0, ac.signal)).rejects.toMatchObject({
      name: "AfeError",
      code: "AFE_ABORTED",
      fallbackSafe: false,
    });
    expect(scheduler.memoryStats().decodedCached).toBe(0);
    scheduler.close();
    await expect(scheduler.getFrameAt(0)).rejects.toBeInstanceOf(AfeError);
  });

  it("close() after open leaves memory at zero decoded frames", () => {
    const bytes = new Uint8Array(readFileSync("tests/fixtures/afe/afe-cfr-30-g1-2s.mp4"));
    const movie = parseIsoBmff(bytes);
    const scheduler = new AfeScheduler(movie, 8);
    expect(scheduler.memoryStats().maxDecodedCached).toBe(8);
    scheduler.close();
    expect(scheduler.memoryStats().decodedCached).toBe(0);
    expect(scheduler.memoryStats().approxBytes).toBe(0);
  });
});
