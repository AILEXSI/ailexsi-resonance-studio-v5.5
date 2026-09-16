/**
 * VIS-RESPONSE-02 — shared scene kick/wave drivers (Preview === Export).
 *
 * applyVisResponse cannot put `energy` onto AudioFeatures, so Lattice / Wave
 * never saw transientBoost. These helpers read only onset / beatPulse / bass
 * (already presented) and apply the same geometry in every renderer.
 * Continuous RMS/band values are not rewritten here.
 * LEXI helpers are additive and must not change Lattice / Wave coefficients.
 */

import type { AudioFeatures } from "./types";

/** Intensity-scaled ring pulse for resonance-wave (central orb + rings). */
export function resonanceRingPulse(features: AudioFeatures, intensity: number): number {
  return 1 + features.bass * 0.28 * intensity + features.beatPulse * 0.38 + (features.onset ? 0.1 : 0);
}

/** Extra wave amplitude (fraction of height) on a kick. */
export function resonanceWaveKickAmp(features: AudioFeatures): number {
  return features.beatPulse * 0.055 + (features.onset ? 0.02 : 0);
}

export function resonanceCoreRadius(features: AudioFeatures, intensity: number): number {
  return 6 + features.bass * 18 * intensity + features.beatPulse * 16 + (features.onset ? 8 : 0);
}

export function resonanceMidFreq(features: AudioFeatures): number {
  return 2 + features.mid * 2.6;
}

/** Lattice warp: bass occupancy + kick punch (01 was bass-only, so pads out-warped kicks). */
export function latticeWarp(features: AudioFeatures, intensity: number): number {
  return (features.bass * 0.42 + features.beatPulse * 0.34 + (features.onset ? 0.1 : 0)) * intensity;
}

export function latticeNodePulse(features: AudioFeatures): number {
  return 0.7 + features.beatPulse * 0.8;
}

/**
 * LEXI horizon lift — bass pressure + kick punch.
 * Distinct from latticeWarp (no pad-heavy occupancy) and Wave ring pulse.
 */
export function lexiHorizonLift(features: AudioFeatures, intensity: number): number {
  return (features.bass * 0.36 + features.beatPulse * 0.24 + (features.onset ? 0.07 : 0)) * intensity;
}

/** Glow / overall amplitude. Scenes read rms, not presentation `energy`. */
export function lexiGlow(features: AudioFeatures, intensity: number): number {
  return (features.rms * 0.74 + features.bass * 0.16) * intensity;
}

/** Soft line breathe / pressure-wave accent. No hard strobe. */
export function lexiAccent(features: AudioFeatures): number {
  return features.beatPulse * 0.26 + (features.onset ? 0.07 : 0);
}

/** Fine surface sheen from spectrum + mid/high. `t` is 0..1 along the horizon. */
export function lexiSheen(features: AudioFeatures, t: number): number {
  const spec = features.spectrum;
  const u = t < 0 ? 0 : t > 1 ? 1 : t;
  if (!spec.length) return features.mid * 0.32 + features.treble * 0.18;
  const idx = Math.min(spec.length - 1, Math.max(0, Math.floor(u * (spec.length - 1))));
  return (spec[idx] ?? 0) * 0.52 + features.mid * 0.18 + features.treble * 0.1;
}
