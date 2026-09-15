import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  isMonotonicRun,
  isPresentationRun,
  parseIsoBmff,
  planDecodeSpan,
  planSampleIndexes,
  pumpSubmitEnd,
  sampleIndexAtTime,
  streamLookaheadSamples,
} from "../../src/core/frame-engine";
import { sequentialTimes } from "./afe-plan";

type ManifestFile = {
  id: string;
  path: string;
  fps: number;
  seconds: number;
  frames: number;
  gop: number;
  bf?: number;
  bframes?: number;
  openGop?: boolean | null;
  pyramid?: boolean;
};

const manifest = JSON.parse(readFileSync("tests/fixtures/afe/manifest.json", "utf8")) as {
  files: ManifestFile[];
};

function load(id: string) {
  const file = manifest.files.find((f) => f.id === id);
  if (!file || !existsSync(file.path)) return null;
  return { file, movie: parseIsoBmff(new Uint8Array(readFileSync(file.path))) };
}

const HARD_IDS = [
  "afe-bframe-30-g120-4s",
  "afe-bframe-30-g16-2s-bf4",
  "afe-bframe-30-g30-2s-bpyramid",
  "afe-bframe-30-g30-2s-opengop",
  "afe-bframe-30-g30-2s-closedgop",
];

describe("AFE-05 harder B-frame fixtures (long GOP / consecutive B / open-closed GOP)", () => {
  it("manifest lists long-GOP, consecutive-B, pyramid, and open/closed GOP files", () => {
    const ids = new Set(manifest.files.map((f) => f.id));
    for (const id of HARD_IDS) expect(ids.has(id), id).toBe(true);
    const long = manifest.files.find((f) => f.id === "afe-bframe-30-g120-4s");
    const bf4 = manifest.files.find((f) => f.id === "afe-bframe-30-g16-2s-bf4");
    expect(long?.gop).toBeGreaterThanOrEqual(120);
    expect(bf4?.bf ?? 0).toBeGreaterThanOrEqual(4);
  });

  it("parses harder B-frame files as variable CTTS with reorder > 0", () => {
    for (const id of HARD_IDS) {
      const hit = load(id);
      expect(hit, id).not.toBeNull();
      const { file, movie } = hit!;
      expect(movie.sampleCount).toBe(file.frames);
      expect(movie.cttsKind).toBe("variable");
      expect(movie.maxReorderSamples).toBeGreaterThan(0);
      const times = sequentialTimes(file);
      const indexes = planSampleIndexes(movie, times);
      expect(isMonotonicRun(indexes, 0, indexes.length)).toBe(false);
      expect(isPresentationRun(movie, indexes, 0, indexes.length)).toBe(true);
    }
  });

  it("mid-GOP Source In + prefetch-end B-request submit past the requested decode index", () => {
    const hit = load("afe-bframe-30-g16-2s-bf4") ?? load("afe-bframe-30-g15-2s");
    expect(hit).not.toBeNull();
    const { file, movie } = hit!;
    const sourceIn = (7.5 / file.fps);
    const idx = sampleIndexAtTime(movie, sourceIn);
    expect(idx).not.toBeNull();
    expect(idx).toBe(movie.presentation[7]!.index);
    const times = [(5.5 / file.fps), (6.5 / file.fps), (7.5 / file.fps)];
    const indexes = planSampleIndexes(movie, times);
    const span = planDecodeSpan(movie, indexes, 0, indexes.length);
    expect(span).not.toBeNull();
    const last = Math.max(...indexes.filter((n): n is number => n != null));
    const end = pumpSubmitEnd({
      requested: idx!,
      last,
      nextDecode: span!.decodeStart,
      sampleCount: movie.sampleCount,
      prefetch: 4,
      maxReorderSamples: movie.maxReorderSamples,
      pendingOutputCount: 0,
    });
    expect(end).toBeGreaterThanOrEqual(idx! + streamLookaheadSamples(movie.maxReorderSamples, 4));
  });

  it("final B-group before GOP end and Source Out still look ahead", () => {
    const hit = load("afe-bframe-30-g30-2s-closedgop") ?? load("afe-bframe-30-g30-2s");
    expect(hit).not.toBeNull();
    const { file, movie } = hit!;
    let idx = movie.presentation[file.frames - 2]!.index;
    for (let i = file.frames - 8; i < file.frames - 1; i++) {
      const candidate = movie.presentation[i]!.index;
      if (candidate < movie.sampleCount - 1) {
        idx = candidate;
        break;
      }
    }
    const end = pumpSubmitEnd({
      requested: idx,
      last: idx,
      nextDecode: idx,
      sampleCount: movie.sampleCount,
      prefetch: 4,
      maxReorderSamples: movie.maxReorderSamples,
      pendingOutputCount: 0,
    });
    if (idx >= movie.sampleCount - 1) {
      expect(end).toBe(idx);
    } else {
      expect(end).toBeGreaterThan(idx);
    }
  });

  it("uneven CTTS / pyramid fixtures keep exact PTS ticks (no snap)", () => {
    const hit = load("afe-bframe-30-g30-2s-bpyramid") ?? load("afe-bframe-30-g15-2s");
    expect(hit).not.toBeNull();
    const { movie } = hit!;
    const offsets = movie.samples.map((s) => s.ptsTimescale - s.dtsTimescale);
    expect(new Set(offsets).size).toBeGreaterThan(1);
    for (let i = 0; i < movie.presentation.length; i++) {
      const t = (i + 0.5) / movie.fpsHint;
      expect(sampleIndexAtTime(movie, t)).toBe(movie.presentation[i]!.index);
    }
  });
});
