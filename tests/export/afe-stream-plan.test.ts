import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  isMonotonicRun,
  isPresentationRun,
  maxDecodeIndex,
  parseIsoBmff,
  planDecodeSpan,
  planSampleIndexes,
  sampleIndexAtTime,
  shouldSplitPresentationRun,
} from "../../src/core/frame-engine";

describe("AFE-03 precomputed sequential plan", () => {
  it("plans each timestamp once and matches live sampleIndexAtTime", () => {
    const movie = parseIsoBmff(new Uint8Array(readFileSync("tests/fixtures/afe/afe-cfr-30-g30-2s.mp4")));
    const times = [];
    for (let i = 0; i < 60; i++) times.push((i + 0.5) / 30);
    const indexes = planSampleIndexes(movie, times);
    expect(indexes).toHaveLength(60);
    for (let i = 0; i < times.length; i++) {
      expect(indexes[i]).toBe(sampleIndexAtTime(movie, times[i]!));
    }
    expect(isMonotonicRun(indexes, 0, indexes.length)).toBe(true);
  });

  it("builds a bounded membership map from keyframe through last requested sample", () => {
    const movie = parseIsoBmff(new Uint8Array(readFileSync("tests/fixtures/afe/afe-cfr-30-g30-2s.mp4")));
    const times = [0.5 / 30, 1.5 / 30, 2.5 / 30];
    const indexes = planSampleIndexes(movie, times);
    const span = planDecodeSpan(movie, indexes, 0, indexes.length);
    expect(span).not.toBeNull();
    expect(span!.decodeStart).toBe(0);
    expect(span!.decodeEnd).toBe(2);
    expect(span!.needed.length).toBe(3);
    expect(Array.from(span!.needed)).toEqual([1, 1, 1]);
  });

  it("marks only requested samples needed when the run skips frames", () => {
    const movie = parseIsoBmff(new Uint8Array(readFileSync("tests/fixtures/afe/afe-cfr-30-g30-2s.mp4")));
    const times = [0.5 / 30, 4.5 / 30];
    const indexes = planSampleIndexes(movie, times);
    const span = planDecodeSpan(movie, indexes, 0, indexes.length);
    expect(span!.needed[0]).toBe(1);
    expect(span!.needed[1]).toBe(0);
    expect(span!.needed[2]).toBe(0);
    expect(span!.needed[3]).toBe(0);
    expect(span!.needed[4]).toBe(1);
    expect(span!.needed.length).toBe(5);
  });

  it("rejects a backward sample-index slice as non-monotonic", () => {
    expect(isMonotonicRun([0, 2, 1], 0, 3)).toBe(false);
    expect(isMonotonicRun([5, 5, 6], 0, 3)).toBe(true);
    expect(isMonotonicRun([1, null, 2], 0, 3)).toBe(false);
  });
});

describe("AFE-04 presentation-run grouping (B-frame wobble vs true seek)", () => {
  it("keeps IBBP decode-index wobble in one run and splits a prior-GOP seek", () => {
    const movie = parseIsoBmff(new Uint8Array(readFileSync("tests/fixtures/afe/afe-cfr-30-g30-2s.mp4")));
    expect(shouldSplitPresentationRun(movie, 3, 1)).toBe(false);
    expect(shouldSplitPresentationRun(movie, 40, 5)).toBe(true);
    expect(isPresentationRun(movie, [0, 2, 3, 1], 0, 4)).toBe(true);
    expect(maxDecodeIndex([0, 2, 3, 1], 0, 4)).toBe(3);
  });
});
