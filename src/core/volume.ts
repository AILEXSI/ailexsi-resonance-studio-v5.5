/**
 * Mixer math. Curve is standard voltage: linear = 10^(dB/20).
 * 0 dB → 1 (unity). -6 dB → ~0.501. -∞ / 0 linear → silence.
 * Fader range +6 … -60 dB; the bottom detent is treated as -∞.
 */
export const FADER_MAX_DB = 6;
export const FADER_MIN_DB = -60;
export const VOLUME_LINEAR_MAX = 10 ** (FADER_MAX_DB / 20); // ≈ 1.995

export function dbToLinear(db: number): number {
  if (!Number.isFinite(db) || db <= FADER_MIN_DB) return 0;
  return 10 ** (db / 20);
}

export function linearToDb(linear: number): number {
  if (!Number.isFinite(linear) || linear <= 0) return Number.NEGATIVE_INFINITY;
  return 20 * Math.log10(linear);
}

export function clampLinearVolume(linear: number): number {
  if (!Number.isFinite(linear) || linear <= 0) return 0;
  return Math.min(VOLUME_LINEAR_MAX, linear);
}

export function faderToDb(pos: number): number {
  const p = Math.max(0, Math.min(1, pos));
  if (p <= 0) return Number.NEGATIVE_INFINITY;
  return FADER_MIN_DB + p * (FADER_MAX_DB - FADER_MIN_DB);
}

export function dbToFader(db: number): number {
  if (!Number.isFinite(db) || db <= FADER_MIN_DB) return 0;
  return Math.max(0, Math.min(1, (db - FADER_MIN_DB) / (FADER_MAX_DB - FADER_MIN_DB)));
}

export function formatDb(db: number): string {
  if (!Number.isFinite(db) || db <= FADER_MIN_DB) return "-∞ dB";
  const rounded = Math.round(db * 10) / 10;
  const sign = rounded > 0 ? "+" : "";
  return `${sign}${rounded.toFixed(1)} dB`;
}

/** Peak sample 0..1 → dB. 1.0 is 0 dBfs. */
export function peakToDb(peak: number): number {
  if (!Number.isFinite(peak) || peak <= 0) return Number.NEGATIVE_INFINITY;
  return 20 * Math.log10(Math.min(1, peak));
}

export function meterHeightPct(peak: number): number {
  const db = peakToDb(peak);
  if (!Number.isFinite(db)) return 0;
  return Math.max(0, Math.min(100, ((db - FADER_MIN_DB) / (0 - FADER_MIN_DB)) * 100));
}

export function mixLinearGain(
  clipGain: number,
  trackVolume: number,
  masterVolume: number,
  muted: boolean,
  automationValue = 1,
): number {
  if (muted) return 0;
  return clampLinearVolume(
    Math.max(0, clipGain) *
      Math.max(0, trackVolume) *
      Math.max(0, Number.isFinite(automationValue) ? automationValue : 1) *
      Math.max(0, masterVolume),
  );
}

/** Track pan −1 (L) … +1 (R). 0 is center. */
export function clampPan(pan: number): number {
  if (!Number.isFinite(pan)) return 0;
  return Math.max(-1, Math.min(1, pan));
}

/**
 * Equal-power stereo law.
 * L = cos((pan+1)/2 * π/2), R = sin((pan+1)/2 * π/2).
 */
export function equalPowerPan(pan: number): { left: number; right: number } {
  const theta = ((clampPan(pan) + 1) / 2) * (Math.PI / 2);
  return { left: Math.cos(theta), right: Math.sin(theta) };
}

/** Mixer label: C at center, L/R plus 0–100 otherwise. */
export function formatPan(pan: number): string {
  const p = clampPan(pan);
  if (Math.abs(p) < 0.02) return "C";
  if (p < 0) return `L${Math.round(-p * 100)}`;
  return `R${Math.round(p * 100)}`;
}
