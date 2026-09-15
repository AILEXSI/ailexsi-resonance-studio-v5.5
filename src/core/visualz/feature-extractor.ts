/**
 * Lightweight Web Audio feature extractor — Visualz (b67410c).
 * Shared onset/energy step is the only musical clock when real audio is loaded.
 * Host can also push synthetic AudioFeatures when no audio is present.
 */

import type { AudioAnalyserConfig, AudioFeatures } from "./types";

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

export function createFeatureExtractor(
  audioContext: AudioContext,
  sourceNode: AudioNode,
  config: AudioAnalyserConfig = {},
): FeatureExtractor {
  const analyser = audioContext.createAnalyser();
  analyser.fftSize = config.fftSize ?? 2048;
  analyser.smoothingTimeConstant = config.smoothingTimeConstant ?? 0.75;
  if (config.minDecibels != null) analyser.minDecibels = config.minDecibels;
  if (config.maxDecibels != null) analyser.maxDecibels = config.maxDecibels;

  sourceNode.connect(analyser);

  const freqBinCount = analyser.frequencyBinCount;
  const freqData = new Uint8Array(freqBinCount);
  const timeData = new Uint8Array(analyser.fftSize);
  const spectrum = new Float32Array(freqBinCount);

  let prevEnergy = 0;
  let lastOnsetTime = Number.NEGATIVE_INFINITY;

  return {
    sample(timeMs = performance.now()) {
      analyser.getByteFrequencyData(freqData);
      analyser.getByteTimeDomainData(timeData);

      let sumSq = 0;
      for (let i = 0; i < timeData.length; i++) {
        const v = ((timeData[i] ?? 128) - 128) / 128;
        sumSq += v * v;
      }
      const rms = Math.min(1, Math.sqrt(sumSq / timeData.length) * 2);

      for (let i = 0; i < freqBinCount; i++) {
        spectrum[i] = (freqData[i] ?? 0) / 255;
      }

      const third = Math.floor(freqBinCount / 6);
      const avg = (start: number, end: number) => {
        let s = 0;
        const n = Math.max(1, end - start);
        for (let i = start; i < end; i++) s += spectrum[i] ?? 0;
        return s / n;
      };
      const bass = avg(0, third);
      const mid = avg(third, third * 3);
      const treble = avg(third * 3, freqBinCount);

      const silent = isSilentEnergy(rms, bass);
      const energy = rms * 0.5 + bass * 0.5;
      const stepped = stepOnset({ energy, prevEnergy, timeMs, lastOnsetTime });
      prevEnergy = stepped.prevEnergy;
      lastOnsetTime = stepped.lastOnsetTime;

      return {
        timeMs,
        rms: silent ? 0 : rms,
        bass: silent ? 0 : bass,
        mid: silent ? 0 : mid,
        treble: silent ? 0 : treble,
        spectrum: spectrum.slice(),
        onset: silent ? false : stepped.onset,
        beatPulse: silent ? 0 : stepped.beatPulse,
        tempoBpm: null,
      };
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
