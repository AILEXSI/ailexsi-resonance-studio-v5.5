import { describe, expect, it } from "vitest";
import {
  chunkTimestampUsToTicks,
  mapSampleToWebCodecs,
  sampleDurationToChunkDurationUs,
  samplePtsToChunkTimestampUs,
} from "../../src/core/frame-engine";

describe("AFE WebCodecs timestamp mapping (PTS → chunk → VideoFrame)", () => {
  it("maps sample PTS ticks to EncodedVideoChunk.timestamp microseconds", () => {
    expect(samplePtsToChunkTimestampUs(0, 30_000)).toBe(0);
    expect(samplePtsToChunkTimestampUs(1000, 30_000)).toBe(Math.round((1000 / 30_000) * 1_000_000));
    expect(samplePtsToChunkTimestampUs(30_000, 30_000)).toBe(1_000_000);
  });

  it("keeps negative PTS (CTTS v1 / edit-list) as negative microseconds", () => {
    expect(samplePtsToChunkTimestampUs(-1500, 30_000)).toBe(Math.round((-1500 / 30_000) * 1_000_000));
    expect(samplePtsToChunkTimestampUs(-1500, 30_000)).toBeLessThan(0);
  });

  it("documents DTS is not the chunk timestamp", () => {
    const sample = { dtsTimescale: 0, ptsTimescale: 2000, durationTimescale: 1000 };
    const mapped = mapSampleToWebCodecs(sample, 30_000);
    expect(mapped.chunkTimestampUs).toBe(samplePtsToChunkTimestampUs(2000, 30_000));
    expect(mapped.chunkTimestampUs).not.toBe(samplePtsToChunkTimestampUs(0, 30_000));
    expect(mapped.expectedVideoFrameTimestampUs).toBe(mapped.chunkTimestampUs);
    expect(mapped.chunkDurationUs).toBe(sampleDurationToChunkDurationUs(1000, 30_000));
  });

  it("round-trips PTS microseconds back to ticks within one microsecond", () => {
    const timescale = 30_000;
    for (const pts of [0, 1000, 2000, 30_000, -1000, 90_000]) {
      const us = samplePtsToChunkTimestampUs(pts, timescale);
      const back = chunkTimestampUsToTicks(us, timescale);
      expect(Math.abs(back - pts)).toBeLessThan(timescale / 1_000_000 + 1e-6);
    }
  });

  it("duration is at least 1 microsecond", () => {
    expect(sampleDurationToChunkDurationUs(0, 30_000)).toBe(1);
    expect(sampleDurationToChunkDurationUs(1000, 30_000)).toBeGreaterThan(1);
  });

  it("IBBP-style samples: submit order is DTS, identity key is PTS", () => {
    const timescale = 30_000;
    const samples = [
      { index: 0, dtsTimescale: 0, ptsTimescale: 0, durationTimescale: 1000 },
      { index: 1, dtsTimescale: 1000, ptsTimescale: 3000, durationTimescale: 1000 },
      { index: 2, dtsTimescale: 2000, ptsTimescale: 1000, durationTimescale: 1000 },
      { index: 3, dtsTimescale: 3000, ptsTimescale: 2000, durationTimescale: 1000 },
    ];
    const chunks = samples.map((s) => mapSampleToWebCodecs(s, timescale));
    expect(chunks.map((c) => c.dtsTimescale)).toEqual([0, 1000, 2000, 3000]);
    expect(chunks.map((c) => c.chunkTimestampUs)).toEqual([
      samplePtsToChunkTimestampUs(0, timescale),
      samplePtsToChunkTimestampUs(3000, timescale),
      samplePtsToChunkTimestampUs(1000, timescale),
      samplePtsToChunkTimestampUs(2000, timescale),
    ]);
    const byPts = [...chunks].sort((a, b) => a.chunkTimestampUs - b.chunkTimestampUs);
    expect(byPts.map((c) => c.ptsTimescale)).toEqual([0, 1000, 2000, 3000]);
  });
});
