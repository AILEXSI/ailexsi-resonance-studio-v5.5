import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  isMonotonicRun,
  isPresentationRun,
  parseIsoBmff,
  planSampleIndexes,
  sampleIndexAtTime,
  shouldSplitPresentationRun,
} from "../../src/core/frame-engine";
import { sequentialTimes } from "./afe-plan";

type Manifest = {
  files: {
    id: string;
    path: string;
    fps: number;
    seconds: number;
    frames: number;
    gop: number;
    bf?: number;
    bframes?: number;
    cttsVersion?: number | null;
    cttsUniqueOffsets?: number;
    nobControl?: boolean;
    rewrittenCttsV0?: boolean;
  }[];
};

const manifest = JSON.parse(readFileSync("tests/fixtures/afe/manifest.json", "utf8")) as Manifest;

function load(id: string) {
  const file = manifest.files.find((f) => f.id === id);
  if (!file || !existsSync(file.path)) return null;
  return { file, movie: parseIsoBmff(new Uint8Array(readFileSync(file.path))) };
}

describe("AFE-04 real B-frame / varying CTTS fixtures", () => {
  it("manifest includes 30fps B-frames, longer GOP, multiple B, no-B control, and CTTS versions", () => {
    const bfiles = manifest.files.filter((f) => (f.bframes ?? 0) > 0 || (f.bf ?? 0) > 0);
    const nob = manifest.files.filter((f) => f.nobControl || ((f.bf ?? 0) === 0 && !f.id.includes("bframe")));
    expect(bfiles.length, "B-frame fixtures").toBeGreaterThanOrEqual(3);
    expect(nob.length, "no-B control").toBeGreaterThanOrEqual(12);
    expect(bfiles.some((f) => f.fps === 30 && f.gop >= 30)).toBe(true);
    expect(bfiles.some((f) => f.gop >= 60)).toBe(true);
    expect(bfiles.some((f) => (f.bf ?? 0) >= 3 || (f.id.includes("g15") && (f.bf ?? 0) > 2))).toBe(true);
    const versions = new Set(bfiles.map((f) => f.cttsVersion));
    expect(versions.has(1) || versions.has(0)).toBe(true);
  });

  it("parses B-frame files instead of AFE_UNSUPPORTED_SAMPLE_TABLE varying ctts", () => {
    const ids = manifest.files.filter((f) => f.id.includes("bframe")).map((f) => f.id);
    expect(ids.length).toBeGreaterThanOrEqual(3);
    for (const id of ids) {
      const hit = load(id);
      expect(hit, id).not.toBeNull();
      const { file, movie } = hit!;
      expect(movie.sampleCount).toBe(file.frames);
      expect(movie.cttsKind).toBe("variable");
      expect(movie.maxReorderSamples).toBeGreaterThan(0);
      expect(movie.samples.every((s) => Number.isSafeInteger(s.ptsTimescale))).toBe(true);
      expect(movie.samples.every((s) => Number.isSafeInteger(s.dtsTimescale))).toBe(true);
      const offsets = movie.samples.map((s) => s.ptsTimescale - s.dtsTimescale);
      expect(new Set(offsets).size).toBeGreaterThan(1);
      const dts = movie.samples.map((s) => s.dtsTimescale);
      for (let i = 1; i < dts.length; i++) expect(dts[i]!).toBeGreaterThanOrEqual(dts[i - 1]!);
    }
  });

  it("no-B control stays constant/absent CTTS with decode order == presentation order", () => {
    const hit = load("afe-cfr-30-g30-2s");
    expect(hit).not.toBeNull();
    const { movie } = hit!;
    expect(movie.cttsKind === "absent" || movie.cttsKind === "constant").toBe(true);
    expect(movie.maxReorderSamples).toBe(0);
    for (let i = 0; i < movie.presentation.length; i++) {
      expect(movie.presentation[i]!.index).toBe(i);
    }
  });

  it("presentation selection is PTS, not decode index, on a 30fps B-GOP", () => {
    const hit = load("afe-bframe-30-g30-2s");
    expect(hit).not.toBeNull();
    const { file, movie } = hit!;
    expect(sampleIndexAtTime(movie, -0.001)).toBeNull();
    for (let i = 0; i < file.frames; i++) {
      const t = (i + 0.5) / file.fps;
      const idx = sampleIndexAtTime(movie, t);
      expect(idx).not.toBeNull();
      const sample = movie.samples[idx!]!;
      const presentRank = movie.presentation.findIndex((s) => s.index === sample.index);
      expect(presentRank).toBe(i);
      expect(sample.ptsTimescale).toBe(movie.presentation[i]!.ptsTimescale);
    }
  });

  it("sequential B-frame indexes are a presentation run, not a monotonic decode run", () => {
    const hit = load("afe-bframe-30-g30-2s");
    expect(hit).not.toBeNull();
    const { file, movie } = hit!;
    const times = sequentialTimes(file);
    const indexes = planSampleIndexes(movie, times);
    expect(isMonotonicRun(indexes, 0, indexes.length)).toBe(false);
    expect(isPresentationRun(movie, indexes, 0, indexes.length)).toBe(true);
    expect(shouldSplitPresentationRun(movie, indexes[0]!, indexes[1]!)).toBe(false);
  });

  it("CTTS v0 (ffmpeg) and v1 (version-byte rewrite) both expand the same per-sample offsets", () => {
    const v0 = load("afe-bframe-30-g30-2s");
    const v1 = load("afe-bframe-30-g30-2s-ctts-v1") ?? load("afe-bframe-30-g30-2s-ctts-v0");
    expect(v0).not.toBeNull();
    expect(v1).not.toBeNull();
    expect(v0!.movie.cttsVersion === 0 || v0!.movie.cttsVersion === 1).toBe(true);
    expect(v1!.movie.cttsVersion).not.toBeNull();
    expect(v0!.movie.cttsKind).toBe("variable");
    expect(v1!.movie.cttsKind).toBe("variable");
    expect(v0!.movie.samples.map((s) => s.ptsTimescale)).toEqual(v1!.movie.samples.map((s) => s.ptsTimescale));
    expect(v0!.movie.samples.map((s) => s.dtsTimescale)).toEqual(v1!.movie.samples.map((s) => s.dtsTimescale));
  });

  it("Source In on a B-presentation frame and random GOP seeks stay PTS-keyed", () => {
    const hit = load("afe-bframe-30-g15-2s");
    expect(hit).not.toBeNull();
    const { file, movie } = hit!;
    const sourceIn = (5.5 / file.fps);
    const idx = sampleIndexAtTime(movie, sourceIn);
    expect(idx).toBe(movie.presentation[5]!.index);
    const seeks = [10, 2, 14, 7, 1].map((n) => (n + 0.5) / file.fps);
    for (const t of seeks) {
      const i = sampleIndexAtTime(movie, t);
      const rank = Math.floor(t * file.fps + 1e-9);
      expect(i).toBe(movie.presentation[rank]!.index);
    }
  });

  it("720p B-frame fixture is H.264 AVC at 1280x720 / 30fps", () => {
    const hit = load("afe-bframe-30-g30-720p-2s");
    expect(hit).not.toBeNull();
    expect(hit!.movie.width).toBe(1280);
    expect(hit!.movie.height).toBe(720);
    expect(hit!.movie.avc.codec.startsWith("avc1.")).toBe(true);
    expect(hit!.movie.cttsKind).toBe("variable");
  });
});
