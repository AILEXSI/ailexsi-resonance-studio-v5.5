/**
 * Deterministic radix-2 FFT + AnalyserNode-equivalent magnitude mapping.
 * Used by the offline (export / mix-PCM) adapter so export spectrum is a real
 * FFT, not a synthetic 64-bin wobble. Matches Preview createFeatureExtractor
 * defaults: fftSize 2048, Blackman window, dB in [-100, -30], smoothing 0.75.
 */

export const ANALYSER_FFT_SIZE = 2048;
export const ANALYSER_SMOOTHING = 0.75;
export const ANALYSER_MIN_DECIBELS = -100;
export const ANALYSER_MAX_DECIBELS = -30;

const TWO_PI = Math.PI * 2;

const windowCache = new Map<number, Float64Array>();

/** Blackman window — Web Audio AnalyserNode (§fft-windowing-and-smoothing-over-time). */
export function blackmanWindow(n: number): Float64Array {
  const cached = windowCache.get(n);
  if (cached) return cached;
  const w = new Float64Array(n);
  if (n <= 1) {
    if (n === 1) w[0] = 1;
    windowCache.set(n, w);
    return w;
  }
  for (let i = 0; i < n; i++) {
    const t = (TWO_PI * i) / n;
    w[i] = 0.42 - 0.5 * Math.cos(t) + 0.08 * Math.cos(2 * t);
  }
  windowCache.set(n, w);
  return w;
}

/** In-place radix-2 Cooley–Tukey. `real`/`imag` length must be a power of two. */
export function fftRadix2(real: Float64Array, imag: Float64Array): void {
  const n = real.length;
  if (n === 0 || (n & (n - 1)) !== 0) {
    throw new Error(`fftRadix2 requires power-of-two length, got ${n}`);
  }
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      const tr = real[i]!;
      real[i] = real[j]!;
      real[j] = tr;
      const ti = imag[i]!;
      imag[i] = imag[j]!;
      imag[j] = ti;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-TWO_PI) / len;
    const wlenRe = Math.cos(ang);
    const wlenIm = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let wr = 1;
      let wi = 0;
      const half = len >> 1;
      for (let k = 0; k < half; k++) {
        const ur = real[i + k]!;
        const ui = imag[i + k]!;
        const vr = real[i + k + half]!;
        const vi = imag[i + k + half]!;
        const tr = wr * vr - wi * vi;
        const ti = wr * vi + wi * vr;
        real[i + k] = ur + tr;
        imag[i + k] = ui + ti;
        real[i + k + half] = ur - tr;
        imag[i + k + half] = ui - ti;
        const nwr = wr * wlenRe - wi * wlenIm;
        wi = wr * wlenIm + wi * wlenRe;
        wr = nwr;
      }
    }
  }
}

function clampDb(db: number, minDb: number, maxDb: number): number {
  if (db < minDb) return minDb;
  if (db > maxDb) return maxDb;
  return db;
}

/**
 * AnalyserNode getByteFrequencyData mapping (Chrome / Web Audio):
 *   magnitude = 2 * |z| / fftSize
 *   dB = 20 * log10(magnitude)
 *   byte = 255 * (clamp(dB, min, max) - min) / (max - min)
 * Smoothing is applied in the dB domain, then stored for the next hop:
 *   X' = smoothing * X'_prev + (1 - smoothing) * X
 * First hop (no prev) uses the current dB (no startup duck).
 */
export function analyserSpectrumFromWindow(
  timeWindow: ArrayLike<number>,
  prevSmoothedDb: Float32Array | null,
  opts?: {
    smoothing?: number;
    minDecibels?: number;
    maxDecibels?: number;
  },
): { spectrum: Float32Array; smoothedDb: Float32Array } {
  const n = timeWindow.length;
  const smoothing = opts?.smoothing ?? ANALYSER_SMOOTHING;
  const minDb = opts?.minDecibels ?? ANALYSER_MIN_DECIBELS;
  const maxDb = opts?.maxDecibels ?? ANALYSER_MAX_DECIBELS;
  const win = blackmanWindow(n);
  const real = new Float64Array(n);
  const imag = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    real[i] = (timeWindow[i] ?? 0) * (win[i] ?? 1);
  }
  fftRadix2(real, imag);

  const bins = n >> 1;
  const smoothedDb = new Float32Array(bins);
  const spectrum = new Float32Array(bins);
  const invN = 2 / n;
  const dbSpan = Math.max(1e-6, maxDb - minDb);
  const keep = smoothing;
  const add = 1 - smoothing;

  for (let k = 0; k < bins; k++) {
    const mag = Math.hypot(real[k] ?? 0, imag[k] ?? 0) * invN;
    const db = mag > 1e-12 ? 20 * Math.log10(mag) : minDb;
    const prev = prevSmoothedDb ? (prevSmoothedDb[k] ?? db) : db;
    const sm = keep * prev + add * db;
    smoothedDb[k] = sm;
    spectrum[k] = (clampDb(sm, minDb, maxDb) - minDb) / dbSpan;
  }
  return { spectrum, smoothedDb };
}

/** Hz of FFT bin `k` for an AnalyserNode-equivalent transform. */
export function binFrequencyHz(k: number, sampleRate: number, fftSize = ANALYSER_FFT_SIZE): number {
  return (k * sampleRate) / fftSize;
}
