import { describe, expect, it } from "vitest";
import {
  FILMSTRIP_THUMB_PX,
  buildPeakMipmap,
  collectFilmstripTimes,
  envelopeForWidth,
  envelopeToPath,
  filmstripTimes,
  peaksFromChannel,
  peaksToPath,
} from "../../src/core/clip-preview";
import { binPosterKind, binPosterTimeMs } from "../../src/ui/timeline/ClipPreview";
import { asset } from "../helpers";

function sine(length: number, cycles: number): Float32Array {
  const out = new Float32Array(length);
  for (let i = 0; i < length; i += 1) {
    out[i] = Math.sin((i / length) * cycles * Math.PI * 2);
  }
  return out;
}

/** Slow amplitude envelope so a long zoom-out still has shape, not a solid block. */
function amSine(length: number, lobes: number, carrierCycles: number): Float32Array {
  const out = new Float32Array(length);
  for (let i = 0; i < length; i += 1) {
    const env = 0.15 + 0.85 * Math.abs(Math.sin((i / length) * lobes * Math.PI));
    out[i] = env * Math.sin((i / length) * carrierCycles * Math.PI * 2);
  }
  return out;
}

function pathXs(d: string): number[] {
  const xs: number[] = [];
  const re = /[ML]\s+(-?[\d.]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(d))) xs.push(Number(m[1]));
  return xs;
}

describe("waveform envelope", () => {
  it("returns ~width min/max pairs for a given pixel width", () => {
    const samples = sine(48_000, 40);
    const env = envelopeForWidth(samples, {
      widthPx: 200,
      sourceInMs: 0,
      sourceOutMs: 1000,
      durationMs: 1000,
    });
    expect(env.max.length).toBe(200);
    expect(env.min.length).toBe(200);
    expect(Math.max(...env.max)).toBeGreaterThan(0.5);
    expect(Math.min(...env.min)).toBeLessThan(-0.5);
  });

  it("zoom-in increases peak count for the same time window", () => {
    const samples = amSine(80_000, 8, 400);
    const window = { sourceInMs: 0, sourceOutMs: 5000, durationMs: 400_000 };
    const coarse = envelopeForWidth(samples, { ...window, widthPx: 200 });
    const fine = envelopeForWidth(samples, { ...window, widthPx: 800 });
    expect(coarse.max.length).toBe(200);
    expect(fine.max.length).toBe(800);
    expect(fine.max.length).toBeGreaterThan(coarse.max.length);
  });

  it("empty / not-ready samples yield an empty envelope (fill fallback)", () => {
    const empty = envelopeForWidth(new Float32Array(0), {
      widthPx: 120,
      sourceInMs: 0,
      sourceOutMs: 1000,
      durationMs: 1000,
    });
    expect(empty.max.length).toBe(0);
    expect(empty.min.length).toBe(0);
    expect(envelopeToPath(empty, 120, 36)).toBe("");
    const vacant = buildPeakMipmap(new Float32Array(0));
    expect(vacant.sampleCount).toBe(0);
    expect(envelopeForWidth(vacant, {
      widthPx: 64,
      sourceInMs: 0,
      sourceOutMs: 1,
      durationMs: 1,
    }).max.length).toBe(0);
  });

  it("fixture path has no inter-bar gaps (adjacent x)", () => {
    const samples = sine(4800, 8);
    const env = peaksFromChannel(samples, 64);
    expect(env.max.length).toBe(64);
    const d = envelopeToPath(env, 64, 36);
    expect(d.startsWith("M ")).toBe(true);
    expect(d.includes(" L ")).toBe(true);
    expect(d.endsWith("Z")).toBe(true);
    const xs = pathXs(d);
    expect(xs.length).toBeGreaterThan(64);
    const dx = 1;
    for (let i = 1; i < xs.length; i += 1) {
      const gap = Math.abs(xs[i]! - xs[i - 1]!);
      expect(gap === 0 || Math.abs(gap - dx) < 1e-6).toBe(true);
    }
    expect(peaksToPath(env, 64, 36)).toBe(d);
  });

  it("keeps real min and max, not max-abs only", () => {
    const samples = new Float32Array([0.2, 0.9, -0.1, -0.75, 0.3]);
    const env = envelopeForWidth(samples, {
      widthPx: 1,
      sourceInMs: 0,
      sourceOutMs: 1,
      durationMs: 1,
    });
    expect(env.max[0]).toBeCloseTo(0.9, 5);
    expect(env.min[0]).toBeCloseTo(-0.75, 5);
  });

  it("zoomed-out long window stays a width-wide envelope, not 10 giant bars", () => {
    const samples = amSine(80_000, 8, 400);
    const env = envelopeForWidth(samples, {
      widthPx: 220,
      sourceInMs: 0,
      sourceOutMs: 400_000,
      durationMs: 400_000,
    });
    expect(env.max.length).toBe(220);
    const uniq = new Set([...env.max].map((v) => v.toFixed(2)));
    expect(uniq.size).toBeGreaterThan(4);
  });

  it("high zoom width is not stuck at a 400-era bucket count", () => {
    const samples = sine(48_000, 40);
    const env = envelopeForWidth(samples, {
      widthPx: 2000,
      sourceInMs: 0,
      sourceOutMs: 1000,
      durationMs: 1000,
    });
    expect(env.max.length).toBe(2000);
    expect(env.max.length).toBeGreaterThan(400);
  });

  it("mipmap paint matches raw extract length without keeping PCM at the call site", () => {
    const samples = sine(4096, 16);
    const mip = buildPeakMipmap(samples);
    expect(mip.levels.length).toBeGreaterThan(0);
    const fromMip = envelopeForWidth(mip, {
      widthPx: 128,
      sourceInMs: 0,
      sourceOutMs: 1000,
      durationMs: 1000,
    });
    expect(fromMip.max.length).toBe(128);
  });
});

describe("video filmstrip", () => {
  it("requests N thumbs along the clip duration via a stubbed decoder", async () => {
    const requested: number[] = [];
    const frames = await collectFilmstripTimes(
      { sourceInMs: 0, sourceOutMs: 10_000, clipWidthPx: 240, thumbWidthPx: 48 },
      async (timeMs) => {
        requested.push(timeMs);
        return `stub:${Math.round(timeMs)}`;
      },
    );
    expect(requested).toHaveLength(5);
    expect(frames).toHaveLength(5);
    expect(requested[0]).toBeGreaterThanOrEqual(0);
    expect(requested[requested.length - 1]!).toBeLessThan(10_000);
    for (let i = 1; i < requested.length; i += 1) {
      expect(requested[i]!).toBeGreaterThan(requested[i - 1]!);
    }
    const planned = filmstripTimes({
      sourceInMs: 1000,
      sourceOutMs: 5000,
      clipWidthPx: 96,
      thumbWidthPx: 48,
    });
    expect(planned).toHaveLength(2);
    expect(planned[0]).toBeGreaterThan(1000);
    expect(planned[1]).toBeLessThan(5000);
  });
});

describe("bin poster uses timeline filmstrip/still times", () => {
  it("video poster time is the first filmstrip tick; image is still; audio/missing skip", () => {
    const video = asset({ id: "v", kind: "video", objectUrl: "blob:v", durationMs: 4000 });
    const image = asset({ id: "i", kind: "image", objectUrl: "blob:i", durationMs: 5000 });
    const audio = asset({ id: "a", kind: "audio", objectUrl: "blob:a" });
    const gone = asset({ id: "g", kind: "video", missing: true, objectUrl: "blob:g" });
    expect(binPosterKind(video)).toBe("video");
    expect(binPosterKind(image)).toBe("image");
    expect(binPosterKind(audio)).toBeNull();
    expect(binPosterKind(gone)).toBeNull();
    const first = filmstripTimes({
      sourceInMs: 0,
      sourceOutMs: 4000,
      clipWidthPx: FILMSTRIP_THUMB_PX,
      kind: "video",
    })[0];
    expect(binPosterTimeMs(video)).toBe(first);
    expect(binPosterTimeMs(image)).toBe(0);
  });
});
