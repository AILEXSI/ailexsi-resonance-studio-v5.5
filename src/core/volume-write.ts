/**
 * H — Write Volume Automation.
 * Captures mixer-fader motion and punches it into the existing G envelope.
 * One model: `{ enabled, points: [{ timeMs, value }] }`. No second engine.
 *
 * Fader ↔ automation mapping
 * - Mixer fader range is the G range: +6 … −∞ dB; linear = 10^(dB/20); 1 = 0 dB.
 * - W OFF, or W ON without an active write gesture: fader reads/writes static
 *   `Track.volume`. G plays normally. Arming W does not overwrite static.
 * - W ON + forward playback + meaningful fader movement: fader linear is the
 *   G automation `value` written at `project.playheadMs`.
 * - Effective mix is unchanged: clipGain × staticTrackVolume × automationValueAt(t).
 * - After the gesture, the fader returns to static; ghost / effective readout
 *   follow the persisted G envelope.
 */

import type { VolumeAutomation } from "./models";
import { linearToDb } from "./volume";
import {
  automationValueAt,
  clampAutomationTimeMs,
  clampAutomationValue,
  defaultVolumeAutomation,
  sanitizeVolumeAutomation,
  sanitizeVolumeAutomationPoint,
  sortVolumeAutomationPoints,
  volumeAutomationIsActive,
  VOLUME_AUTOMATION_UNITY,
  type VolumeAutomationPoint,
} from "./volume-automation";

export type { VolumeAutomationPoint };

/** Minimum playhead gap before storing another raw sample (live value still updates). */
export const WRITE_CAPTURE_MIN_MS = 40;
/** Stop moving the fader → end the write gesture after this idle. */
export const WRITE_IDLE_END_MS = 280;
/** Pointer-up may commit slightly sooner than mid-drag idle. */
export const WRITE_POINTER_UP_MS = 80;
/** Minimum |ΔdB| from the static rest position to start a gesture. */
export const WRITE_MEANINGFUL_DB = 0.35;
/** Minimum |Δlinear| from the static rest position to start a gesture. */
export const WRITE_MEANINGFUL_LINEAR = 0.02;
/** Consecutive points closer than this in linear gain are redundant (unless a peak). */
export const WRITE_MIN_LINEAR_DELTA = 0.015;
/** Consecutive points closer than this in dB are redundant (unless a peak). */
export const WRITE_MIN_DB_DELTA = 0.3;
/** Ramer–Douglas–Peucker epsilon in (time-seconds, linear-gain) space. */
export const WRITE_RDP_EPSILON = 0.02;
/** Local extremum kept if it sticks out by at least this linear amount. */
export const WRITE_PEAK_LINEAR = 0.02;
/**
 * Empty / identity envelopes hold the prior value until just before the first
 * written time, and again just after the last, so a punch does not flood the
 * whole timeline (H5). G hold-after-last would otherwise silence the rest of
 * the song if the gesture ended below unity.
 */
export const WRITE_IDENTITY_HOLD_MS = 1;
/** Playhead jump backward larger than this ends the current gesture (loop wrap). */
export const WRITE_LOOP_WRAP_MS = 80;

export interface VolumeWriteGesture {
  trackId: string;
  startMs: number;
  endMs: number;
  samples: VolumeAutomationPoint[];
  /** Latest fader linear — audible immediately; not punched until commit. */
  liveValue: number;
  /** Envelope before this gesture — undo / abort / punch source. */
  before: VolumeAutomation;
  /** Wall clock of the last captured sample (idle / punch boundary). */
  lastSampleAtMs: number;
}

/** Live write overrides G at the playhead for the writing track only. */
export function liveWriteAutomationValue(
  trackId: string,
  envelope: VolumeAutomation | undefined | null,
  playheadMs: number,
  liveTrackId?: string | null,
  liveValue?: number | null,
): number {
  if (liveTrackId === trackId && liveValue != null && Number.isFinite(liveValue)) {
    return clampAutomationValue(liveValue) ?? liveValue;
  }
  return automationValueAt(envelope, playheadMs);
}

/** Samples actually punched on gesture end (includes trailing live value). */
export function gestureSamplesForCommit(
  gesture: VolumeWriteGesture,
  playheadMs: number,
): VolumeAutomationPoint[] {
  const live = clampAutomationValue(gesture.liveValue);
  const t = clampAutomationTimeMs(Math.max(playheadMs, gesture.endMs));
  if (live == null || t == null) return coalesceWriteSamples(gesture.samples);
  return coalesceWriteSamples([...gesture.samples, { timeMs: t, value: live }]);
}

export function isMeaningfulWriteMove(from: number, to: number): boolean {
  const a = clampAutomationValue(from);
  const b = clampAutomationValue(to);
  if (a == null || b == null) return false;
  if (Math.abs(a - b) >= WRITE_MEANINGFUL_LINEAR) return true;
  const dbA = linearToDb(a);
  const dbB = linearToDb(b);
  if (!Number.isFinite(dbA) && !Number.isFinite(dbB)) return false;
  if (!Number.isFinite(dbA) || !Number.isFinite(dbB)) return true;
  return Math.abs(dbA - dbB) >= WRITE_MEANINGFUL_DB;
}

export function faderLinearToAutomationValue(linear: number): number | null {
  return clampAutomationValue(linear);
}

function valuesNearlyEqual(a: number, b: number): boolean {
  if (Math.abs(a - b) < WRITE_MIN_LINEAR_DELTA) return true;
  const dbA = linearToDb(a);
  const dbB = linearToDb(b);
  if (!Number.isFinite(dbA) && !Number.isFinite(dbB)) return true;
  if (!Number.isFinite(dbA) || !Number.isFinite(dbB)) return false;
  return Math.abs(dbA - dbB) < WRITE_MIN_DB_DELTA;
}

/** Last write wins on a duplicate timestamp; invalid points dropped. */
export function coalesceWriteSamples(
  samples: readonly VolumeAutomationPoint[],
): VolumeAutomationPoint[] {
  return sortVolumeAutomationPoints(
    samples
      .map((p) => sanitizeVolumeAutomationPoint(p))
      .filter((p): p is VolumeAutomationPoint => p != null),
  );
}

function collapseFlatRuns(points: readonly VolumeAutomationPoint[]): VolumeAutomationPoint[] {
  if (points.length <= 2) return [...points];
  const out: VolumeAutomationPoint[] = [points[0]!];
  for (let i = 1; i < points.length - 1; i += 1) {
    const prev = out[out.length - 1]!;
    const cur = points[i]!;
    const next = points[i + 1]!;
    if (valuesNearlyEqual(prev.value, cur.value) && valuesNearlyEqual(cur.value, next.value)) {
      continue;
    }
    out.push(cur);
  }
  out.push(points[points.length - 1]!);
  return out;
}

function peakTimes(points: readonly VolumeAutomationPoint[]): Set<number> {
  const keep = new Set<number>();
  for (let i = 1; i < points.length - 1; i += 1) {
    const a = points[i - 1]!.value;
    const b = points[i]!.value;
    const c = points[i + 1]!.value;
    const peakUp = b - a >= WRITE_PEAK_LINEAR && b - c >= WRITE_PEAK_LINEAR;
    const peakDown = a - b >= WRITE_PEAK_LINEAR && c - b >= WRITE_PEAK_LINEAR;
    if (peakUp || peakDown) keep.add(points[i]!.timeMs);
  }
  return keep;
}

function pointLineDistance(
  p: VolumeAutomationPoint,
  a: VolumeAutomationPoint,
  b: VolumeAutomationPoint,
): number {
  const x1 = a.timeMs / 1000;
  const y1 = a.value;
  const x2 = b.timeMs / 1000;
  const y2 = b.value;
  const x0 = p.timeMs / 1000;
  const y0 = p.value;
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy);
  if (len < 1e-12) return Math.hypot(x0 - x1, y0 - y1);
  return Math.abs(dy * x0 - dx * y0 + x2 * y1 - y2 * x1) / len;
}

function ramerDouglasPeucker(
  points: readonly VolumeAutomationPoint[],
  epsilon: number,
): VolumeAutomationPoint[] {
  if (points.length <= 2) return [...points];
  const first = points[0]!;
  const last = points[points.length - 1]!;
  let maxDist = 0;
  let maxIdx = 0;
  for (let i = 1; i < points.length - 1; i += 1) {
    const d = pointLineDistance(points[i]!, first, last);
    if (d > maxDist) {
      maxDist = d;
      maxIdx = i;
    }
  }
  if (maxDist > epsilon) {
    const left = ramerDouglasPeucker(points.slice(0, maxIdx + 1), epsilon);
    const right = ramerDouglasPeucker(points.slice(maxIdx), epsilon);
    return [...left.slice(0, -1), ...right];
  }
  return [first, last];
}

/**
 * Capture then coalesce. Deterministic. First + last + peaks kept.
 * Not one point per mouse/callback — flat runs and near-colinear spans drop.
 */
export function simplifyWriteSamples(
  samples: readonly VolumeAutomationPoint[],
): VolumeAutomationPoint[] {
  const unique = coalesceWriteSamples(samples);
  if (unique.length <= 2) return unique;
  const peaks = peakTimes(unique);
  const collapsed = collapseFlatRuns(unique);
  const reduced = ramerDouglasPeucker(collapsed, WRITE_RDP_EPSILON);
  const byTime = new Map<number, VolumeAutomationPoint>();
  for (const p of reduced) byTime.set(p.timeMs, p);
  for (const p of unique) {
    if (peaks.has(p.timeMs)) byTime.set(p.timeMs, p);
  }
  return sortVolumeAutomationPoints([...byTime.values()]);
}

export function writeSampleTimes(
  samples: readonly VolumeAutomationPoint[],
): { startMs: number; endMs: number } | null {
  const clean = coalesceWriteSamples(samples);
  if (clean.length === 0) return null;
  return { startMs: clean[0]!.timeMs, endMs: clean[clean.length - 1]!.timeMs };
}

function identityHoldPrefix(t0: number): VolumeAutomationPoint[] {
  if (t0 <= 0) return [];
  const holdAt = Math.max(0, t0 - WRITE_IDENTITY_HOLD_MS);
  const points: VolumeAutomationPoint[] = [{ timeMs: 0, value: VOLUME_AUTOMATION_UNITY }];
  if (holdAt > 0) points.push({ timeMs: holdAt, value: VOLUME_AUTOMATION_UNITY });
  return points;
}

/** Prior envelope value just after t1 — identity when the curve was empty/disabled. */
function restoreAfterPoint(existing: VolumeAutomation, t1: number): VolumeAutomationPoint | null {
  const restoreAt = t1 + WRITE_IDENTITY_HOLD_MS;
  const t = clampAutomationTimeMs(restoreAt);
  if (t == null) return null;
  const raw = automationValueAt({ ...existing, enabled: true }, t);
  const value = clampAutomationValue(raw) ?? VOLUME_AUTOMATION_UNITY;
  return { timeMs: t, value };
}

/**
 * Replace only [firstWritten, lastWritten]. Preserve points strictly before/after.
 * Empty identity envelopes get a unity hold before t0 and after t1 so the punch
 * does not flood the rest of the track (no whole-song silence / 0-gain hold).
 * Always returns a sanitized G envelope. Never wipes the existing curve on failure.
 */
export function punchVolumeWrite(
  existing: VolumeAutomation | undefined | null,
  samples: readonly VolumeAutomationPoint[],
): VolumeAutomation {
  const current = sanitizeVolumeAutomation(existing) ?? defaultVolumeAutomation();
  const written = simplifyWriteSamples(samples);
  if (written.length === 0) return current;
  const t0 = written[0]!.timeMs;
  const t1 = written[written.length - 1]!.timeMs;
  if (!Number.isFinite(t0) || !Number.isFinite(t1) || t1 < t0) return current;

  const before = current.points.filter((p) => p.timeMs < t0);
  const after = current.points.filter((p) => p.timeMs > t1);
  const seeded =
    before.length === 0 && !volumeAutomationIsActive(current) ? identityHoldPrefix(t0) : before;
  const restore = restoreAfterPoint(current, t1);
  return {
    enabled: true,
    points: sortVolumeAutomationPoints([...seeded, ...written, ...(restore ? [restore] : []), ...after]),
  };
}

export function writeGestureIsIdle(gesture: VolumeWriteGesture | null | undefined, nowMs: number, idleMs = WRITE_IDLE_END_MS): boolean {
  if (!gesture) return true;
  const now = Number.isFinite(nowMs) ? nowMs : 0;
  return now - gesture.lastSampleAtMs >= idleMs;
}

export function appendWriteSample(
  gesture: VolumeWriteGesture | null,
  trackId: string,
  timeMs: number,
  value: number,
  before: VolumeAutomation,
  nowMs: number,
): { gesture: VolumeWriteGesture; started: boolean; wrapped: boolean } | null {
  const point = sanitizeVolumeAutomationPoint({ timeMs, value });
  const t = clampAutomationTimeMs(timeMs);
  if (!point || t == null) return null;
  if (gesture && gesture.trackId !== trackId) return null;

  if (gesture && point.timeMs + WRITE_LOOP_WRAP_MS < gesture.endMs) {
    return { gesture, started: false, wrapped: true };
  }

  if (!gesture) {
    return {
      gesture: {
        trackId,
        startMs: point.timeMs,
        endMs: point.timeMs,
        samples: [point],
        liveValue: point.value,
        before,
        lastSampleAtMs: nowMs,
      },
      started: true,
      wrapped: false,
    };
  }

  const samples = [...gesture.samples];
  const last = samples[samples.length - 1];
  if (last && last.timeMs === point.timeMs) {
    samples[samples.length - 1] = point;
  } else if (last && point.timeMs < last.timeMs) {
    return {
      gesture: { ...gesture, liveValue: point.value, lastSampleAtMs: nowMs },
      started: false,
      wrapped: false,
    };
  } else if (
    last &&
    point.timeMs - last.timeMs < WRITE_CAPTURE_MIN_MS &&
    valuesNearlyEqual(last.value, point.value)
  ) {
    return {
      gesture: { ...gesture, liveValue: point.value, lastSampleAtMs: nowMs },
      started: false,
      wrapped: false,
    };
  } else {
    samples.push(point);
  }
  return {
    gesture: {
      ...gesture,
      endMs: Math.max(gesture.endMs, point.timeMs),
      samples,
      liveValue: point.value,
      lastSampleAtMs: nowMs,
    },
    started: false,
    wrapped: false,
  };
}
