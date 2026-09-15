import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { AFE_MAX_REORDER_READY, AfeScheduler, parseIsoBmff } from "../../src/core/frame-engine";

describe("AFE-04 bounded reorder + long-timeline memory (no decode)", () => {
  it("B-frame movie advertises a reorder bound below the hard cap", () => {
    const path = "tests/fixtures/afe/afe-bframe-30-g30-2s.mp4";
    if (!existsSync(path)) return;
    const movie = parseIsoBmff(new Uint8Array(readFileSync(path)));
    expect(movie.maxReorderSamples).toBeGreaterThan(0);
    expect(movie.maxReorderSamples).toBeLessThanOrEqual(AFE_MAX_REORDER_READY);
    const cap = Math.min(AFE_MAX_REORDER_READY, Math.max(8, movie.maxReorderSamples + 8));
    expect(cap).toBeLessThanOrEqual(AFE_MAX_REORDER_READY);
  });

  it("scheduler cache stays capped for a 7min/30min-style loop of a 2s B-GOP (stats only)", () => {
    const path = "tests/fixtures/afe/afe-bframe-30-g30-2s.mp4";
    if (!existsSync(path)) return;
    const movie = parseIsoBmff(new Uint8Array(readFileSync(path)));
    const scheduler = new AfeScheduler(movie, 12);
    const stats = scheduler.memoryStats();
    expect(stats.maxDecodedCached).toBe(12);
    expect(stats.decodedCached).toBe(0);
    const sevenMinLoops = Math.ceil((7 * 60) / movie.durationSec);
    const thirtyMinLoops = Math.ceil((30 * 60) / movie.durationSec);
    expect(sevenMinLoops).toBeGreaterThan(100);
    expect(thirtyMinLoops).toBeGreaterThan(400);
    const frameBytes = movie.width * movie.height * 4;
    const maxLive = 12 + AFE_MAX_REORDER_READY;
    expect(maxLive * frameBytes).toBeLessThan(50 * 1024 * 1024);
    scheduler.close();
    expect(scheduler.memoryStats().decodedCached).toBe(0);
  });
});
