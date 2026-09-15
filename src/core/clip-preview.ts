/** One min/max pair per horizontal column (DAW peak envelope). */
export type MinMaxPeaks = {
  min: Float32Array;
  max: Float32Array;
};

export type PeakMipLevel = {
  min: Float32Array;
  max: Float32Array;
  /** Original samples covered by each bucket. */
  stride: number;
};

/** Pyramid of min/max buckets. Built once after decode; paints only read this. */
export type PeakMipmap = {
  sampleCount: number;
  levels: PeakMipLevel[];
};

export function isPeakMipmap(value: unknown): value is PeakMipmap {
  return !!value && typeof value === "object" && "sampleCount" in value && "levels" in value;
}

/** Pair-reduce a channel into a min/max pyramid. Does not keep the raw PCM. */
export function buildPeakMipmap(samples: ArrayLike<number>): PeakMipmap {
  const sampleCount = samples.length;
  if (sampleCount === 0) return { sampleCount: 0, levels: [] };

  let stride = 2;
  let len = Math.ceil(sampleCount / 2);
  let mins = new Float32Array(len);
  let maxs = new Float32Array(len);
  for (let i = 0; i < len; i += 1) {
    const i0 = i * 2;
    const a = samples[i0] ?? 0;
    const b = i0 + 1 < sampleCount ? (samples[i0 + 1] ?? a) : a;
    mins[i] = a < b ? a : b;
    maxs[i] = a > b ? a : b;
  }
  const levels: PeakMipLevel[] = [{ min: mins, max: maxs, stride }];

  while (len > 2) {
    const nextLen = Math.ceil(len / 2);
    const nextMin = new Float32Array(nextLen);
    const nextMax = new Float32Array(nextLen);
    for (let i = 0; i < nextLen; i += 1) {
      const i0 = i * 2;
      const i1 = i0 + 1 < len ? i0 + 1 : i0;
      const loA = mins[i0] ?? 0;
      const loB = mins[i1] ?? loA;
      const hiA = maxs[i0] ?? 0;
      const hiB = maxs[i1] ?? hiA;
      nextMin[i] = loA < loB ? loA : loB;
      nextMax[i] = hiA > hiB ? hiA : hiB;
    }
    stride *= 2;
    mins = nextMin;
    maxs = nextMax;
    len = nextLen;
    levels.push({ min: mins, max: maxs, stride });
  }

  return { sampleCount, levels };
}

export function envelopeWidthPx(widthPx: number): number {
  return Math.max(1, Math.round(widthPx));
}

/**
 * ~1 min/max pair per CSS pixel for a source-time window.
 * Zoom-in (more pixels, same window) returns more pairs.
 */
export function envelopeForWidth(
  source: ArrayLike<number> | PeakMipmap,
  opts: {
    widthPx: number;
    sourceInMs: number;
    sourceOutMs: number;
    durationMs: number;
  },
): MinMaxPeaks {
  const width = envelopeWidthPx(opts.widthPx);
  const mip = isPeakMipmap(source) ? source : buildPeakMipmap(source);
  if (mip.sampleCount === 0 || mip.levels.length === 0) {
    return { min: new Float32Array(0), max: new Float32Array(0) };
  }

  const dur = Math.max(opts.durationMs, 1);
  const a = Math.max(0, Math.min(1, opts.sourceInMs / dur));
  const b = Math.max(a, Math.min(1, opts.sourceOutMs / dur));
  const i0 = Math.floor(a * mip.sampleCount);
  const i1 = Math.max(i0 + 1, Math.ceil(b * mip.sampleCount));
  const windowSamples = i1 - i0;
  const samplesPerPx = windowSamples / width;

  let level = mip.levels[0]!;
  for (const cand of mip.levels) {
    if (cand.stride <= samplesPerPx) level = cand;
    else break;
  }

  const min = new Float32Array(width);
  const max = new Float32Array(width);
  const stride = level.stride;
  const last = level.min.length;

  for (let x = 0; x < width; x += 1) {
    const s0 = i0 + Math.floor((x * windowSamples) / width);
    const s1 = x === width - 1 ? i1 : i0 + Math.floor(((x + 1) * windowSamples) / width);
    const b0 = Math.max(0, Math.floor(s0 / stride));
    const b1 = Math.min(last, Math.max(b0 + 1, Math.ceil(Math.max(s1, s0 + 1) / stride)));
    let lo = Infinity;
    let hi = -Infinity;
    for (let i = b0; i < b1; i += 1) {
      const loV = level.min[i] ?? 0;
      const hiV = level.max[i] ?? 0;
      if (loV < lo) lo = loV;
      if (hiV > hi) hi = hiV;
    }
    if (lo === Infinity || hi === -Infinity) {
      min[x] = 0;
      max[x] = 0;
    } else {
      min[x] = lo;
      max[x] = hi;
    }
  }

  return { min, max };
}

/** Full-channel envelope at `buckets` columns (tests / fixtures). */
export function peaksFromChannel(samples: ArrayLike<number>, buckets: number): MinMaxPeaks {
  return envelopeForWidth(samples, {
    widthPx: buckets,
    sourceInMs: 0,
    sourceOutMs: 1,
    durationMs: 1,
  });
}

function fmt(n: number): string {
  return n.toFixed(2);
}

function clampAmp(v: number): number {
  if (v > 1) return 1;
  if (v < -1) return -1;
  return v;
}

/**
 * Filled +peak/−peak silhouette. Column i occupies [i·dx, (i+1)·dx] — no bar gaps.
 * When `width === peaks.max.length`, adjacent x are 1 CSS pixel apart.
 */
export function envelopeToPath(peaks: MinMaxPeaks, width: number, height: number): string {
  const n = peaks.max.length;
  if (n === 0 || peaks.min.length === 0) return "";
  const w = Math.max(1, width);
  const h = Math.max(2, height);
  const mid = h / 2;
  const amp = mid - 1;
  const dx = w / n;

  const yAt = (v: number) => mid - clampAmp(v) * amp;

  const parts: string[] = [`M 0 ${fmt(yAt(peaks.max[0] ?? 0))}`];
  for (let i = 0; i < n; i += 1) {
    const x1 = (i + 1) * dx;
    parts.push(`L ${fmt(x1)} ${fmt(yAt(peaks.max[i] ?? 0))}`);
  }
  for (let i = n - 1; i >= 0; i -= 1) {
    const x1 = (i + 1) * dx;
    const x0 = i * dx;
    const y = yAt(peaks.min[i] ?? 0);
    parts.push(`L ${fmt(x1)} ${fmt(y)}`);
    parts.push(`L ${fmt(x0)} ${fmt(y)}`);
  }
  parts.push("Z");
  return parts.join(" ");
}

/** @deprecated alias — use envelopeToPath */
export function peaksToPath(peaks: MinMaxPeaks, width: number, height: number): string {
  return envelopeToPath(peaks, width, height);
}

export const FILMSTRIP_THUMB_PX = 48;

/** Source-media timestamps (ms) spaced along the clip for a filmstrip. Stills: one thumb. */
export function filmstripTimes(opts: {
  sourceInMs: number;
  sourceOutMs: number;
  clipWidthPx: number;
  thumbWidthPx?: number;
  kind?: "video" | "audio" | "image";
}): number[] {
  if (opts.kind === "image") return [opts.sourceInMs];
  const thumb = Math.max(16, opts.thumbWidthPx ?? FILMSTRIP_THUMB_PX);
  const n = Math.max(1, Math.floor(opts.clipWidthPx / thumb));
  const span = Math.max(1, opts.sourceOutMs - opts.sourceInMs);
  const times: number[] = [];
  for (let i = 0; i < n; i += 1) {
    times.push(opts.sourceInMs + ((i + 0.5) / n) * span);
  }
  return times;
}

export async function collectFilmstripTimes(
  opts: Parameters<typeof filmstripTimes>[0],
  fetchFrame: (timeMs: number) => Promise<unknown>,
): Promise<{ timeMs: number; frame: unknown }[]> {
  const times = filmstripTimes(opts);
  const out: { timeMs: number; frame: unknown }[] = [];
  for (const timeMs of times) {
    out.push({ timeMs, frame: await fetchFrame(timeMs) });
  }
  return out;
}
