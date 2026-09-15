import { readFileSync, existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  keyframeAtOrBefore,
  parseIsoBmff,
  sampleIndexAtTime,
} from "../../src/core/frame-engine";

type Manifest = {
  generated: boolean;
  files: {
    id: string;
    path: string;
    fps: number;
    seconds: number;
    frames: number;
    gop: number;
    keyframeSec: number[];
    width?: number;
  }[];
};

const manifest = JSON.parse(readFileSync("tests/fixtures/afe/manifest.json", "utf8")) as Manifest;

describe("AFE ISO-BMFF reader", () => {
  it("ships generated CFR H.264 files with probed keyframes (not third-party media)", () => {
    expect(manifest.generated).toBe(true);
    expect(manifest.files.length).toBeGreaterThanOrEqual(12);
    for (const file of manifest.files) {
      expect(existsSync(file.path)).toBe(true);
      expect(file.frames).toBe(Math.round(file.fps * file.seconds));
      expect(file.keyframeSec.length).toBeGreaterThan(0);
      if (!file.id.includes("opengop")) {
        expect(file.keyframeSec[0]).toBe(0);
      }
      const bytes = readFileSync(file.path);
      expect(String.fromCharCode(bytes[4]!, bytes[5]!, bytes[6]!, bytes[7]!)).toBe("ftyp");
    }
  });

  it("parses every fixture: one AVC track, sample count, PTS, keyframe index", () => {
    for (const file of manifest.files) {
      const movie = parseIsoBmff(new Uint8Array(readFileSync(file.path)));
      expect(movie.avc.codec.startsWith("avc1.")).toBe(true);
      expect(movie.sampleCount).toBe(file.frames);
      expect(movie.samples[0]!.isKeyframe).toBe(true);
      expect(sampleIndexAtTime(movie, 0)).toBe(movie.presentation[0]!.index);
      expect(sampleIndexAtTime(movie, 1 / file.fps)).toBe(movie.presentation[1]!.index);
      const last = file.frames - 1;
      expect(sampleIndexAtTime(movie, (last + 0.5) / file.fps)).toBe(movie.presentation[last]!.index);
      expect(keyframeAtOrBefore(movie, 0)).toBe(0);
      const mid = Math.min(file.gop, file.frames - 1);
      const kf = keyframeAtOrBefore(movie, mid);
      expect(kf).toBeLessThanOrEqual(mid);
      expect(movie.samples[kf]!.isKeyframe).toBe(true);
    }
  });

  it("uses last-PTS-≤-request selection matching floor(t*fps) on these CFR files", () => {
    const file = manifest.files.find((f) => f.id === "afe-cfr-30-g30-2s")!;
    const movie = parseIsoBmff(new Uint8Array(readFileSync(file.path)));
    for (let i = 0; i < file.frames; i++) {
      const center = (i + 0.5) / file.fps;
      expect(sampleIndexAtTime(movie, center)).toBe(i);
      expect(sampleIndexAtTime(movie, i / file.fps)).toBe(i);
    }
    expect(sampleIndexAtTime(movie, -0.001)).toBeNull();
  });
});
