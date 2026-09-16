import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  decodeOrigin,
  decoderConfigOf,
  firstAvcCSps,
  inspectAvcSpsRestriction,
  isOpenGopAtKey,
  keyframeAtOrBefore,
  nextKeyframeAfter,
  parseIsoBmff,
  sampleIndexAtTime,
  ticksToUs,
} from "../../src/core/frame-engine";
import { sourceTimeSec } from "../../src/core/exporter/frame-source";

const GOP = "tests/fixtures/afe/stress-01-clip-start-gop.mp4";

const HUMAN = {
  sample: 3,
  ptsUs: 100_000,
  neighborEarly: 66_667,
  neighborLate: 133_333,
  sourceInMs: 0,
  sourceOutMs: 38_600,
  fps: 30,
};

function load(path: string) {
  if (!existsSync(path)) return null;
  return parseIsoBmff(new Uint8Array(readFileSync(path)));
}

describe("STRESS-01 clip-start exact PTS 100000", () => {
  it("A. sample 3 is PTS 100000, presentation index 1, visible after elst mediaTime 40", () => {
    const movie = load(GOP);
    expect(movie).not.toBeNull();
    if (!movie) return;
    expect(movie.timescale).toBe(600);
    expect(movie.editListOffset).toBe(40);
    expect(movie.sampleCount).toBeGreaterThanOrEqual(16);
    expect(movie.maxReorderSamples).toBe(2);
    expect(movie.avc.codec).toBe("avc1.4d001e");
    expect(movie.keyframeIndices[0]).toBe(0);
    expect(movie.keyframeIndices[1]).toBe(29);

    const rows = movie.samples.slice(0, 16).map((s) => ({
      index: s.index,
      dts: s.dtsTimescale,
      pts: s.ptsTimescale,
      duration: s.durationTimescale,
      sync: s.isKeyframe,
      presentationIndex: movie.presentation.findIndex((p) => p.index === s.index),
      compositionOffset: s.ptsTimescale - s.dtsTimescale,
      byteLength: s.byteSize,
      ptsUs: ticksToUs(s.ptsTimescale, movie.timescale),
    }));
    expect(rows[0]).toMatchObject({
      index: 0,
      dts: 0,
      pts: 40,
      sync: true,
      presentationIndex: 0,
      compositionOffset: 40,
      ptsUs: HUMAN.neighborEarly,
    });
    expect(rows[3]).toMatchObject({
      index: HUMAN.sample,
      dts: 60,
      pts: 60,
      duration: 20,
      sync: false,
      presentationIndex: 1,
      compositionOffset: 0,
      ptsUs: HUMAN.ptsUs,
    });
    expect(rows[2]!.ptsUs).toBe(HUMAN.neighborLate);
    expect(movie.samples[3]!.ptsTimescale).toBeGreaterThanOrEqual(movie.editListOffset);
  });

  it("B. sample 0 is the closed-GOP IDR origin; sample 3 does not need a prior GOP", () => {
    const movie = load(GOP);
    expect(movie).not.toBeNull();
    if (!movie) return;
    expect(movie.samples[0]!.isKeyframe).toBe(true);
    expect(keyframeAtOrBefore(movie, 3)).toBe(0);
    expect(nextKeyframeAfter(movie, 0)).toBe(29);
    expect(isOpenGopAtKey(movie, 0)).toBe(false);
    expect(decodeOrigin(movie, 3)).toBe(0);
  });

  it("C. sourceInMs 0 second output frame selects sample 3 / PTS 100000 — not an edit-list hole", () => {
    const movie = load(GOP);
    expect(movie).not.toBeNull();
    if (!movie) return;
    const first = sourceTimeSec(
      { startMs: 0, sourceInMs: HUMAN.sourceInMs, sourceOutMs: HUMAN.sourceOutMs, rate: 1 } as never,
      0,
      HUMAN.fps,
    );
    const second = sourceTimeSec(
      { startMs: 0, sourceInMs: HUMAN.sourceInMs, sourceOutMs: HUMAN.sourceOutMs, rate: 1 } as never,
      1000 / HUMAN.fps,
      HUMAN.fps,
    );
    expect(sampleIndexAtTime(movie, first)).toBe(0);
    expect(sampleIndexAtTime(movie, second)).toBe(HUMAN.sample);
    expect(ticksToUs(movie.samples[3]!.ptsTimescale, movie.timescale)).toBe(HUMAN.ptsUs);
  });

  it("D. avcC SPS omits bitstream_restriction; decoderConfigOf patches it and keeps prefer-software + exact PTS", () => {
    const movie = load(GOP);
    expect(movie).not.toBeNull();
    if (!movie) return;
    const raw = inspectAvcSpsRestriction(firstAvcCSps(movie.avc.description)!);
    expect(raw).not.toBeNull();
    expect(raw!.vuiPresent).toBe(true);
    expect(raw!.bitstreamRestrictionFlag).toBe(0);
    expect(raw!.needsPatch).toBe(true);

    const cfg = decoderConfigOf(movie.avc);
    expect(cfg.hardwareAcceleration).toBe("prefer-software");
    expect(cfg.optimizeForLatency).toBe(false);
    expect(cfg.codec).toBe(movie.avc.codec);
    expect(cfg.description).not.toBe(movie.avc.description);
    const patched = inspectAvcSpsRestriction(firstAvcCSps(cfg.description as Uint8Array)!);
    expect(patched).not.toBeNull();
    expect(patched!.bitstreamRestrictionFlag).toBe(1);
    expect(patched!.needsPatch).toBe(false);
    expect(patched!.numReorderFrames).toBeGreaterThanOrEqual(2);
    expect(ticksToUs(movie.samples[3]!.ptsTimescale, movie.timescale)).toBe(HUMAN.ptsUs);
  });

  it("E. AFE-25 analog still no-ops the patch (prefer-software + same avcC)", () => {
    const eof = load("tests/fixtures/afe/afe-eof-24-g145-b3.mp4");
    expect(eof).not.toBeNull();
    if (!eof) return;
    const raw = inspectAvcSpsRestriction(firstAvcCSps(eof.avc.description)!);
    expect(raw?.needsPatch).toBe(false);
    const cfg = decoderConfigOf(eof.avc);
    expect(cfg.hardwareAcceleration).toBe("prefer-software");
    expect(cfg.description).toBe(eof.avc.description);
  });
});
