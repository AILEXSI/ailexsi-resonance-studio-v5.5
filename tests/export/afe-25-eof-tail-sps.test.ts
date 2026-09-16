import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  decoderConfigOf,
  firstAvcCSps,
  inspectAvcSpsRestriction,
  lastRequiredDecodeSample,
  parseIsoBmff,
  sampleIndexAtTime,
  ticksToUs,
} from "../../src/core/frame-engine";
import { sourceTimeSec } from "../../src/core/exporter/frame-source";

const EOF = "tests/fixtures/afe/afe-eof-24-g145-b3.mp4";

const HUMAN = {
  sample: 142,
  ptsUs: 5_958_333,
  lastDecodedTs: 5_916_667,
  lastSubmitted: 144,
  sourceInMs: 4509.1,
  sourceOutMs: 6042,
  timelineMs: (41 / 30) * 1000,
  fps: 30,
};

function load(path: string) {
  if (!existsSync(path)) return null;
  return parseIsoBmff(new Uint8Array(readFileSync(path)));
}

describe("AFE-25 EOF tail differential — CASE B prefer-software", () => {
  it("A. 145-frame 24fps analog: sample 142 is PTS 5958333; 143/144 are later decode refs", () => {
    const movie = load(EOF);
    expect(movie).not.toBeNull();
    if (!movie) return;
    expect(movie.sampleCount).toBe(145);
    expect(movie.samples[144]!.index).toBe(144);
    expect(Math.round(movie.durationSec * 1000)).toBe(6042);
    expect(ticksToUs(movie.samples[142]!.ptsTimescale, movie.timescale)).toBe(HUMAN.ptsUs);
    expect(ticksToUs(movie.samples[139]!.ptsTimescale, movie.timescale)).toBe(HUMAN.lastDecodedTs);
    expect(movie.samples[142]!.isKeyframe).toBe(false);
    expect(movie.samples[143]).toBeTruthy();
    expect(movie.samples[144]).toBeTruthy();
    expect(
      lastRequiredDecodeSample({
        lastRequested: 142,
        maxReorderSamples: movie.maxReorderSamples,
        prefetch: 4,
        sampleCount: movie.sampleCount,
      }),
    ).toBe(144);
  });

  it("B. human last-frame sourceTime selects existing sample 142 / 5958333 — not CASE A", () => {
    const movie = load(EOF);
    expect(movie).not.toBeNull();
    if (!movie) return;
    const t = sourceTimeSec(
      { startMs: 0, sourceInMs: HUMAN.sourceInMs, sourceOutMs: HUMAN.sourceOutMs, rate: 1 } as never,
      HUMAN.timelineMs,
      HUMAN.fps,
    );
    const idx = sampleIndexAtTime(movie, t);
    expect(idx).toBe(142);
    expect(ticksToUs(movie.samples[idx!]!.ptsTimescale, movie.timescale)).toBe(HUMAN.ptsUs);
  });

  it("C. avcC SPS already has bitstream_restriction — missing VUI is not this clip's hole", () => {
    const movie = load(EOF);
    expect(movie).not.toBeNull();
    if (!movie) return;
    const info = inspectAvcSpsRestriction(firstAvcCSps(movie.avc.description)!);
    expect(info).not.toBeNull();
    expect(info!.bitstreamRestrictionFlag).toBe(1);
    expect(info!.needsPatch).toBe(false);
    expect(info!.maxDecFrameBuffering).toBeGreaterThan(0);
  });

  it("D. decoderConfigOf asks prefer-software (CASE B WebView2 HW tail drop); exact PTS unchanged", () => {
    const movie = load(EOF);
    expect(movie).not.toBeNull();
    if (!movie) return;
    const cfg = decoderConfigOf(movie.avc);
    expect(cfg.hardwareAcceleration).toBe("prefer-software");
    expect(cfg.optimizeForLatency).toBe(false);
    expect(cfg.description).toBe(movie.avc.description);
    expect(ticksToUs(movie.samples[142]!.ptsTimescale, movie.timescale)).toBe(HUMAN.ptsUs);
  });
});
