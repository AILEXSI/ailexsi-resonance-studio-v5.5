/**
 * Lightweight Web Audio feature extractor — Visualz (b67410c).
 * Shared onset/energy/spectrum step is the only musical clock when real audio
 * is loaded. Preview (AnalyserNode) and Export (offline PCM FFT) both call
 * assembleAudioFeatures so they cannot drift into unrelated algorithms.
 */

import type { AudioAnalyserConfig, AudioFeatures } from "./types";
import {
  ANALYSER_FFT_SIZE,
  ANALYSER_MAX_DECIBELS,
  ANALYSER_MIN_DECIBELS,
  ANALYSER_SMOOTHING,
  analyserSpectrumFromWindow,
} from "./fft";

export {
  ANALYSER_FFT_SIZE,
  ANALYSER_MAX_DECIBELS,
  ANALYSER_MIN_DECIBELS,
  ANALYSER_SMOOTHING,
} from "./fft";

export interface FeatureExtractor {
  sample(timeMs?: number): AudioFeatures;
  disconnect(): void;
}

/** Standalone Visualz onset: energy delta + refractory. Not a BPM grid. */
export const ONSET_DELTA = 0.12;
export const ONSET_REFRACTORY_MS = 120;
/** ~0.045 per 60 Hz frame → pulse fades in ~360ms. */
export const BEAT_PULSE_DECAY_MS = 360;

/**
 * Silence gate from standalone Visualz (`src/audio/feature-extractor.ts`).
 * When RMS/bass sit below these floors, kick/onset/`beatPulse` stay 0.
 */
export const SILENCE_RMS = 0.02;
export const SILENCE_BASS = 0.03;

/** Preview-like hop when the caller jumps (seek / first sample / VIS after VIDEO). */
export const ANALYSIS_HOP_MS = 1000 / 60;
/** Enough history for beatPulse decay + refractory + a bit of energy smoothing. */
export const ANALYSIS_WARMUP_MS = 500;

export type MixPcm = Pick<AudioBuffer, "sampleRate" | "length" | "numberOfChannels" | "getChannelData">;

export type FeatureState = {
  prevEnergy: number;
  lastOnsetTime: number;
};

export function createFeatureState(): FeatureState {
  return { prevEnergy: 0, lastOnsetTime: Number.NEGATIVE_INFINITY };
}

export function isSilentEnergy(rms: number, bass: number): boolean {
  return rms < SILENCE_RMS && bass < SILENCE_BASS;
}

/** Zero musical bands when the Visualz silence gate trips. Spectrum is left as-is. */
export function applySilenceGate(features: AudioFeatures): AudioFeatures {
  if (!isSilentEnergy(features.rms, features.bass)) return features;
  return {
    ...features,
    rms: 0,
    bass: 0,
    mid: 0,
    treble: 0,
    onset: false,
    beatPulse: 0,
  };
}

export function stepOnset(opts: {
  energy: number;
  prevEnergy: number;
  timeMs: number;
  lastOnsetTime: number;
}): { onset: boolean; beatPulse: number; lastOnsetTime: number; prevEnergy: number } {
  const delta = opts.energy - opts.prevEnergy;
  const onset = delta > ONSET_DELTA && opts.timeMs - opts.lastOnsetTime > ONSET_REFRACTORY_MS;
  const lastOnsetTime = onset ? opts.timeMs : opts.lastOnsetTime;
  const since = Number.isFinite(lastOnsetTime) ? opts.timeMs - lastOnsetTime : BEAT_PULSE_DECAY_MS;
  const beatPulse = onset ? 1 : Math.max(0, 1 - since / BEAT_PULSE_DECAY_MS);
  return {
    onset,
    beatPulse: Number.isFinite(lastOnsetTime) ? beatPulse : 0,
    lastOnsetTime,
    prevEnergy: opts.energy * 0.85 + opts.prevEnergy * 0.15,
  };
}

/**
 * Preview band split: `third = floor(frequencyBinCount / 6)`.
 * At fftSize 2048 / 44.1 kHz that is bass 0–~3.66 kHz, mid ~3.66–11.0 kHz,
 * treble ~11.0–22.05 kHz — not musical octaves. Export must use the same edges.
 */
export function bandsFromSpectrum(spectrum: ArrayLike<number>): { bass: number; mid: number; treble: number } {
  const freqBinCount = spectrum.length;
  const third = Math.floor(freqBinCount / 6);
  const avg = (start: number, end: number) => {
    let s = 0;
    const n = Math.max(1, end - start);
    for (let i = start; i < end; i++) s += spectrum[i] ?? 0;
    return s / n;
  };
  return {
    bass: avg(0, third),
    mid: avg(third, third * 3),
    treble: avg(third * 3, freqBinCount),
  };
}

/** Same RMS as Preview `getByteTimeDomainData` after mapping bytes back to ±1. */
export function rmsFromTimeDomain(samples: ArrayLike<number>): number {
  const n = samples.length;
  if (n <= 0) return 0;
  let sumSq = 0;
  for (let i = 0; i < n; i++) {
    const v = samples[i] ?? 0;
    sumSq += v * v;
  }
  return Math.min(1, Math.sqrt(sumSq / n) * 2);
}

export function assembleAudioFeatures(opts: {
  timeMs: number;
  rms: number;
  bass: number;
  mid: number;
  treble: number;
  spectrum: Float32Array;
  state: FeatureState;
}): AudioFeatures {
  const silent = isSilentEnergy(opts.rms, opts.bass);
  const energy = opts.rms * 0.5 + opts.bass * 0.5;
  const stepped = stepOnset({
    energy,
    prevEnergy: opts.state.prevEnergy,
    timeMs: opts.timeMs,
    lastOnsetTime: opts.state.lastOnsetTime,
  });
  opts.state.prevEnergy = stepped.prevEnergy;
  opts.state.lastOnsetTime = stepped.lastOnsetTime;
  return {
    timeMs: opts.timeMs,
    rms: silent ? 0 : opts.rms,
    bass: silent ? 0 : opts.bass,
    mid: silent ? 0 : opts.mid,
    treble: silent ? 0 : opts.treble,
    spectrum: opts.spectrum,
    onset: silent ? false : stepped.onset,
    beatPulse: silent ? 0 : stepped.beatPulse,
    tempoBpm: null,
  };
}

/** Adapter A — live AnalyserNode bytes already FFT'd + smoothed by Web Audio. */
export function featuresFromAnalyserBytes(
  freqData: ArrayLike<number>,
  timeData: ArrayLike<number>,
  timeMs: number,
  state: FeatureState,
): AudioFeatures {
  const spectrum = new Float32Array(freqData.length);
  for (let i = 0; i < freqData.length; i++) spectrum[i] = (freqData[i] ?? 0) / 255;
  const floats = new Float32Array(timeData.length);
  for (let i = 0; i < timeData.length; i++) {
    floats[i] = ((timeData[i] ?? 128) - 128) / 128;
  }
  const rms = rmsFromTimeDomain(floats);
  const { bass, mid, treble } = bandsFromSpectrum(spectrum);
  return assembleAudioFeatures({ timeMs, rms, bass, mid, treble, spectrum, state });
}

export function createFeatureExtractor(
  audioContext: AudioContext,
  sourceNode: AudioNode,
  config: AudioAnalyserConfig = {},
): FeatureExtractor {
  const analyser = audioContext.createAnalyser();
  analyser.fftSize = config.fftSize ?? ANALYSER_FFT_SIZE;
  analyser.smoothingTimeConstant = config.smoothingTimeConstant ?? ANALYSER_SMOOTHING;
  if (config.minDecibels != null) analyser.minDecibels = config.minDecibels;
  if (config.maxDecibels != null) analyser.maxDecibels = config.maxDecibels;

  sourceNode.connect(analyser);

  const freqBinCount = analyser.frequencyBinCount;
  const freqData = new Uint8Array(freqBinCount);
  const timeData = new Uint8Array(analyser.fftSize);
  const state = createFeatureState();

  return {
    sample(timeMs = performance.now()) {
      analyser.getByteFrequencyData(freqData);
      analyser.getByteTimeDomainData(timeData);
      return featuresFromAnalyserBytes(freqData, timeData, timeMs, state);
    },

    disconnect() {
      try {
        sourceNode.disconnect(analyser);
      } catch {
        // already disconnected
      }
    },
  };
}

export type OfflineFeatureExtractor = FeatureExtractor & {
  reset(): void;
  lastTimeMs(): number;
};

function monoSample(buf: MixPcm, index: number): number {
  if (index < 0 || index >= buf.length) return 0;
  const chans = Math.max(1, buf.numberOfChannels);
  let s = 0;
  for (let c = 0; c < chans; c++) s += buf.getChannelData(c)[index] ?? 0;
  return s / chans;
}

/** Causal fftSize window ending at `timeMs` (live AnalyserNode = most recent samples). */
export function pcmWindowAt(buf: MixPcm, timeMs: number, fftSize = ANALYSER_FFT_SIZE): Float32Array {
  const sr = buf.sampleRate > 0 ? buf.sampleRate : 44100;
  const end = Math.round((Math.max(0, timeMs) / 1000) * sr);
  const start = end - fftSize;
  const window = new Float32Array(fftSize);
  for (let i = 0; i < fftSize; i++) window[i] = monoSample(buf, start + i);
  return window;
}

export type OfflineExtractorOptions = {
  hopMs?: number;
  fftSize?: number;
  smoothingTimeConstant?: number;
  minDecibels?: number;
  maxDecibels?: number;
};

/**
 * Adapter B — AudioBuffer / mixed OfflineAudioContext PCM.
 * Sequential sample(tN+1) advances smoothed spectrum, prevEnergy, lastOnsetTime
 * from sample(tN). Same-time re-sample is cached (export paints VIS twice).
 * Backward seek resets and warms up. Long forward jumps hop-fill.
 */
export function createOfflineFeatureExtractor(
  buf: MixPcm,
  opts: OfflineExtractorOptions = {},
): OfflineFeatureExtractor {
  const hopMs = opts.hopMs && opts.hopMs > 0 ? opts.hopMs : ANALYSIS_HOP_MS;
  const fftSize = opts.fftSize ?? ANALYSER_FFT_SIZE;
  const smoothing = opts.smoothingTimeConstant ?? ANALYSER_SMOOTHING;
  const minDecibels = opts.minDecibels ?? ANALYSER_MIN_DECIBELS;
  const maxDecibels = opts.maxDecibels ?? ANALYSER_MAX_DECIBELS;

  let state = createFeatureState();
  let smoothedDb: Float32Array | null = null;
  let lastTimeMs = Number.NEGATIVE_INFINITY;
  let lastFeatures: AudioFeatures | null = null;

  const analyzeAt = (timeMs: number): AudioFeatures => {
    const window = pcmWindowAt(buf, timeMs, fftSize);
    const spec = analyserSpectrumFromWindow(window, smoothedDb, {
      smoothing,
      minDecibels,
      maxDecibels,
    });
    smoothedDb = spec.smoothedDb;
    const rms = rmsFromTimeDomain(window);
    const { bass, mid, treble } = bandsFromSpectrum(spec.spectrum);
    lastFeatures = assembleAudioFeatures({
      timeMs,
      rms,
      bass,
      mid,
      treble,
      spectrum: spec.spectrum,
      state,
    });
    lastTimeMs = timeMs;
    return lastFeatures;
  };

  const warmupTo = (timeMs: number) => {
    const from = Math.max(0, timeMs - ANALYSIS_WARMUP_MS);
    if (timeMs - from <= hopMs) {
      analyzeAt(timeMs);
      return;
    }
    for (let t = from; t < timeMs - 1e-6; t += hopMs) analyzeAt(t);
    analyzeAt(timeMs);
  };

  const reset = () => {
    state = createFeatureState();
    smoothedDb = null;
    lastTimeMs = Number.NEGATIVE_INFINITY;
    lastFeatures = null;
  };

  return {
    sample(timeMs = 0) {
      if (lastFeatures && Math.abs(timeMs - lastTimeMs) < 1e-6) return lastFeatures;
      if (!Number.isFinite(lastTimeMs) || timeMs < lastTimeMs - 1e-6) {
        reset();
        warmupTo(timeMs);
        return lastFeatures!;
      }
      const dt = timeMs - lastTimeMs;
      if (dt > hopMs * 1.5) {
        for (let t = lastTimeMs + hopMs; t < timeMs - 1e-6; t += hopMs) analyzeAt(t);
      }
      return analyzeAt(timeMs);
    },
    reset,
    lastTimeMs: () => lastTimeMs,
    disconnect() {
      reset();
    },
  };
}

const extractorCache = new WeakMap<object, OfflineFeatureExtractor>();

/** One extractor per PCM object so sequential preview/export calls keep state. */
export function offlineExtractorFor(buf: MixPcm, opts?: OfflineExtractorOptions): OfflineFeatureExtractor {
  const key = buf as object;
  const existing = extractorCache.get(key);
  if (existing) return existing;
  const created = createOfflineFeatureExtractor(buf, opts);
  extractorCache.set(key, created);
  return created;
}
