import { describe, expect, it } from "vitest";
import { AfeError, addTimescale, buildSampleTable, parseCtts } from "../../src/core/frame-engine";
import { cttsBox, parsedBoxOf } from "./mp4-synth";

function expand(entries: { count: number; offset: number }[]): number[] {
  const out: number[] = [];
  for (const e of entries) for (let i = 0; i < e.count; i++) out.push(e.offset);
  return out;
}

describe("AFE CTTS parse + expand (absent / v0 unsigned / v1 signed)", () => {
  it("parses absent CTTS as a null table and buildSampleTable uses offset 0", () => {
    const samples = buildSampleTable({
      stts: [{ count: 3, delta: 1000 }],
      ctts: null,
      stsc: [{ firstChunk: 1, samplesPerChunk: 3, descriptionIndex: 1 }],
      sampleSize: 8,
      sampleSizes: [],
      sampleCount: 3,
      chunkOffsets: [0],
      syncSamples: null,
    });
    expect(samples.map((s) => s.dtsTimescale)).toEqual([0, 1000, 2000]);
    expect(samples.map((s) => s.ptsTimescale)).toEqual([0, 1000, 2000]);
  });

  it("parses CTTS v0 unsigned offsets and preserves per-sample values", () => {
    const entries = [
      { count: 1, offset: 2000 },
      { count: 2, offset: 0 },
      { count: 1, offset: 1000 },
    ];
    const box = cttsBox(0, entries);
    const parsed = parseCtts(box, parsedBoxOf(box));
    expect(parsed.version).toBe(0);
    expect(parsed.entries).toEqual(entries);
    expect(expand(parsed.entries)).toEqual([2000, 0, 0, 1000]);
  });

  it("parses CTTS v1 signed offsets including negatives", () => {
    const entries = [
      { count: 1, offset: 3000 },
      { count: 2, offset: -1000 },
      { count: 1, offset: 0 },
    ];
    const box = cttsBox(1, entries);
    const parsed = parseCtts(box, parsedBoxOf(box));
    expect(parsed.version).toBe(1);
    expect(parsed.entries).toEqual(entries);
    expect(parsed.entries[1]!.offset).toBe(-1000);
  });

  it("expands CTTS to stsz/stts length and computes PTS = DTS + offset", () => {
    const samples = buildSampleTable({
      stts: [{ count: 4, delta: 1000 }],
      ctts: [
        { count: 1, offset: 2000 },
        { count: 2, offset: -1000 },
        { count: 1, offset: 0 },
      ],
      stsc: [{ firstChunk: 1, samplesPerChunk: 4, descriptionIndex: 1 }],
      sampleSize: 4,
      sampleSizes: [],
      sampleCount: 4,
      chunkOffsets: [0],
      syncSamples: [1],
    });
    expect(samples.map((s) => ({ dts: s.dtsTimescale, pts: s.ptsTimescale, i: s.index }))).toEqual([
      { dts: 0, pts: 2000, i: 0 },
      { dts: 1000, pts: 0, i: 1 },
      { dts: 2000, pts: 1000, i: 2 },
      { dts: 3000, pts: 3000, i: 3 },
    ]);
    expect(samples[1]!.isKeyframe).toBe(false);
    expect(samples[0]!.isKeyframe).toBe(true);
  });

  it("rejects ctts count <= 0, length mismatch, and unknown version", () => {
    const badCount = cttsBox(0, [{ count: 0, offset: 1 }]);
    expect(() => parseCtts(badCount, parsedBoxOf(badCount))).toThrow(AfeError);
    try {
      parseCtts(badCount, parsedBoxOf(badCount));
    } catch (e) {
      expect((e as AfeError).code).toBe("AFE_UNSUPPORTED_SAMPLE_TABLE");
      expect((e as AfeError).message).toMatch(/count <= 0/);
    }

    const v2 = new Uint8Array(cttsBox(0, [{ count: 1, offset: 1 }]));
    v2[8] = 2;
    try {
      parseCtts(v2, parsedBoxOf(v2));
      expect.fail("expected throw");
    } catch (e) {
      expect((e as AfeError).code).toBe("AFE_UNSUPPORTED_SAMPLE_TABLE");
      expect((e as AfeError).message).toMatch(/unsupported ctts version 2/);
    }

    expect(() =>
      buildSampleTable({
        stts: [{ count: 2, delta: 1 }],
        ctts: [{ count: 3, offset: 0 }],
        stsc: [{ firstChunk: 1, samplesPerChunk: 2, descriptionIndex: 1 }],
        sampleSize: 1,
        sampleSizes: [],
        sampleCount: 2,
        chunkOffsets: [0],
        syncSamples: null,
      }),
    ).toThrow(/ctts samples 3 != stsz 2/);
  });

  it("allows deliberate negative PTS and rejects unsafe arithmetic", () => {
    const samples = buildSampleTable({
      stts: [{ count: 1, delta: 100 }],
      ctts: [{ count: 1, offset: -250 }],
      stsc: [{ firstChunk: 1, samplesPerChunk: 1, descriptionIndex: 1 }],
      sampleSize: 1,
      sampleSizes: [],
      sampleCount: 1,
      chunkOffsets: [0],
      syncSamples: null,
    });
    expect(samples[0]!.ptsTimescale).toBe(-250);
    expect(() => addTimescale(Number.MAX_SAFE_INTEGER, 2, "pts")).toThrow(AfeError);
    expect(() => addTimescale(1.5, 1, "pts")).toThrow(AfeError);
  });

  it("does not reject varying CTTS (B-frames) — unique offset count > 1 is valid", () => {
    const box = cttsBox(1, [
      { count: 1, offset: 2000 },
      { count: 1, offset: -1000 },
      { count: 1, offset: 0 },
    ]);
    const parsed = parseCtts(box, parsedBoxOf(box));
    expect(new Set(parsed.entries.map((e) => e.offset)).size).toBeGreaterThan(1);
    expect(parsed.entries.map((e) => e.offset)).toEqual([2000, -1000, 0]);
  });
});
