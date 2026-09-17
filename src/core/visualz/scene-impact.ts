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
 * V2: kick reads harder than V1; still a decaying envelope, not a strobe.
 */
export function lexiHorizonLift(features: AudioFeatures, intensity: number): number {
  return (features.bass * 0.34 + features.beatPulse * 0.38 + (features.onset ? 0.1 : 0)) * intensity;
}

/** Glow / overall amplitude. Scenes read rms, not presentation `energy`. */
export function lexiGlow(features: AudioFeatures, intensity: number): number {
  return (features.rms * 0.68 + features.bass * 0.18 + features.mid * 0.12) * intensity;
}

/** Soft line breathe / pressure-wave accent. No hard strobe. */
export function lexiAccent(features: AudioFeatures): number {
  return features.beatPulse * 0.38 + (features.onset ? 0.1 : 0);
}

/** Bass + kick thicken the energy band and near ridges. */
export function lexiHorizonBody(features: AudioFeatures, intensity: number): number {
  return (features.bass * 0.48 + features.beatPulse * 0.32 + (features.onset ? 0.08 : 0)) * intensity;
}

/** Mid shapes terrain wavelength / lateral spread. */
export function lexiTerrainSpread(features: AudioFeatures, intensity: number): number {
  return (features.mid * 0.62 + features.rms * 0.16) * intensity;
}

/** Fine surface sheen from spectrum + mid/high. `t` is 0..1 along the horizon. */
export function lexiSheen(features: AudioFeatures, t: number): number {
  const spec = features.spectrum;
  const u = t < 0 ? 0 : t > 1 ? 1 : t;
  if (!spec.length) return features.mid * 0.32 + features.treble * 0.22;
  const idx = Math.min(spec.length - 1, Math.max(0, Math.floor(u * (spec.length - 1))));
  return (spec[idx] ?? 0) * 0.46 + features.mid * 0.22 + features.treble * 0.16;
}

/**
 * LEXI V3 — mids drive large form (hero peak / valley), not glow.
 * Additive. Does not change V2 Minimal Horizon coefficients.
 */
export function lexiFormShift(features: AudioFeatures, intensity: number): number {
  return (features.mid * 0.74 + features.rms * 0.14) * intensity;
}

/** Kick / onset envelope for expanding pressure rings. High at hit, then decays. */
export function lexiPressureWave(features: AudioFeatures): number {
  return features.beatPulse * 0.78 + (features.onset ? 0.18 : 0);
}

/** Highlight-only bloom (localized). Must stay small — not a gold wash. */
export function lexiHighlightBloom(features: AudioFeatures, intensity: number): number {
  return (features.beatPulse * 0.42 + features.rms * 0.18 + features.bass * 0.1) * intensity;
}

/** Slow asymmetric hero-peak wander so the picture is not a screensaver. */
export function lexiPeakBias(timeMs: number, speed: number): number {
  return 0.88 + Math.sin(timeMs * 0.000092 * speed) * 0.58;
}
