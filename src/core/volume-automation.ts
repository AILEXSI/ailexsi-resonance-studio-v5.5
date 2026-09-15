/**
 * G — Volume Automation. Track-owned, one parameter (VOLUME), linear only.
 * Internal values are linear gain (1 = 0 dB unity) to match the mix engine.
 * Empty or disabled envelopes are identity (exact prior playback).
 */

import {
  kindOfTrack,
  trackById,
  type Project,
  type Track,
  type TrackId,
  type VolumeAutomation,
} from "./models";
import { clampLinearVolume } from "./volume";

export type { VolumeAutomation };

export interface VolumeAutomationPoint {
  timeMs: number;
  value: number;
}

/** 0 dB / unity. Empty and disabled envelopes evaluate to this. */
export const VOLUME_AUTOMATION_UNITY = 1;

export function defaultVolumeAutomation(): VolumeAutomation {
  return { enabled: false, points: [] };
}

export function clampAutomationTimeMs(timeMs: number): number | null {
  if (!Number.isFinite(timeMs)) return null;
  return Math.max(0, Math.round(timeMs));
}

export function clampAutomationValue(value: number): number | null {
  if (!Number.isFinite(value)) return null;
  return clampLinearVolume(value);
}

export function sanitizeVolumeAutomationPoint(raw: unknown): VolumeAutomationPoint | null {
  if (!raw || typeof raw !== "object") return null;
  const rec = raw as Record<string, unknown>;
  const timeMs = clampAutomationTimeMs(Number(rec.timeMs));
  const value = clampAutomationValue(Number(rec.value));
  if (timeMs == null || value == null) return null;
  return { timeMs, value };
}

export function sortVolumeAutomationPoints(
  points: readonly VolumeAutomationPoint[],
): VolumeAutomationPoint[] {
  const byTime = new Map<number, VolumeAutomationPoint>();
  for (const point of points) {
    const clean = sanitizeVolumeAutomationPoint(point);
    if (!clean) continue;
    byTime.set(clean.timeMs, clean);
  }
  return [...byTime.values()].sort((a, b) => a.timeMs - b.timeMs);
}

export function sanitizeVolumeAutomation(raw: unknown): VolumeAutomation | undefined {
  if (raw == null) return undefined;
  if (typeof raw !== "object") return undefined;
  const rec = raw as Record<string, unknown>;
  const points = Array.isArray(rec.points)
    ? sortVolumeAutomationPoints(rec.points.map((p) => sanitizeVolumeAutomationPoint(p)).filter((p): p is VolumeAutomationPoint => p != null))
    : [];
  return {
    enabled: rec.enabled === true,
    points,
  };
}

/** Legacy D stub `automationLanes` volume points → G envelope (enabled when points exist). */
export function volumeAutomationFromLanes(raw: unknown): VolumeAutomation | undefined {
  if (!Array.isArray(raw)) return undefined;
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    if (rec.kind !== "volume" && rec.kind != null) continue;
    const points = sortVolumeAutomationPoints(
      (Array.isArray(rec.points) ? rec.points : [])
        .map((p) => sanitizeVolumeAutomationPoint(p))
        .filter((p): p is VolumeAutomationPoint => p != null),
    );
    if (points.length === 0) continue;
    return { enabled: true, points };
  }
  return undefined;
}

export function resolveVolumeAutomation(
  volumeAutomation: unknown,
  automationLanes?: unknown,
): VolumeAutomation | undefined {
  const direct = sanitizeVolumeAutomation(volumeAutomation);
  if (direct) return direct;
  return volumeAutomationFromLanes(automationLanes);
}

export function volumeAutomationOf(track: Track | undefined | null): VolumeAutomation {
  return track?.volumeAutomation ?? defaultVolumeAutomation();
}

export function volumeAutomationIsActive(automation: VolumeAutomation | undefined | null): boolean {
  return Boolean(automation?.enabled && (automation.points?.length ?? 0) > 0);
}

/**
 * Deterministic linear interpolation of stored linear values.
 * Empty / disabled → 1. One point → constant. Hold before first and after last.
 */
export function automationValueAt(
  automation: VolumeAutomation | undefined | null,
  timeMs: number,
): number {
  if (!automation || !automation.enabled) return VOLUME_AUTOMATION_UNITY;
  const points = automation.points;
  if (!points || points.length === 0) return VOLUME_AUTOMATION_UNITY;
  const t = Number.isFinite(timeMs) ? Math.max(0, timeMs) : 0;
  if (points.length === 1) return points[0]!.value;
  if (t <= points[0]!.timeMs) return points[0]!.value;
  const last = points[points.length - 1]!;
  if (t >= last.timeMs) return last.value;
  for (let i = 1; i < points.length; i += 1) {
    const b = points[i]!;
    if (t > b.timeMs) continue;
    const a = points[i - 1]!;
    const span = b.timeMs - a.timeMs;
    if (span <= 0) return b.value;
    const mix = (t - a.timeMs) / span;
    return a.value + (b.value - a.value) * mix;
  }
  return last.value;
}

export function setTrackVolumeAutomation(
  project: Project,
  trackId: TrackId,
  automation: VolumeAutomation,
): Project {
  const track = trackById(project, trackId);
  if (!track || kindOfTrack(trackId) !== "audio") return project;
  const next = sanitizeVolumeAutomation(automation) ?? defaultVolumeAutomation();
  const prev = volumeAutomationOf(track);
  if (prev.enabled === next.enabled && pointsEqual(prev.points, next.points)) return project;
  return {
    ...project,
    tracks: project.tracks.map((t) => (t.id === trackId ? { ...t, volumeAutomation: next } : t)),
    updatedAt: new Date().toISOString(),
  };
}

export function setVolumeAutomationEnabled(
  project: Project,
  trackId: TrackId,
  enabled: boolean,
): Project {
  const track = trackById(project, trackId);
  if (!track || kindOfTrack(trackId) !== "audio") return project;
  const current = volumeAutomationOf(track);
  if (current.enabled === enabled) return project;
  return setTrackVolumeAutomation(project, trackId, { ...current, enabled });
}

export function addVolumeAutomationPoint(
  project: Project,
  trackId: TrackId,
  timeMs: number,
  value: number,
): { project: Project; point?: VolumeAutomationPoint } {
  const track = trackById(project, trackId);
  if (!track || kindOfTrack(trackId) !== "audio") return { project };
  const point = sanitizeVolumeAutomationPoint({ timeMs, value });
  if (!point) return { project };
  const current = volumeAutomationOf(track);
  const points = sortVolumeAutomationPoints([...current.points.filter((p) => p.timeMs !== point.timeMs), point]);
  const next = setTrackVolumeAutomation(project, trackId, { enabled: true, points });
  return { project: next, point };
}

export function deleteVolumeAutomationPoint(
  project: Project,
  trackId: TrackId,
  timeMs: number,
): Project {
  const track = trackById(project, trackId);
  if (!track || kindOfTrack(trackId) !== "audio") return project;
  const current = volumeAutomationOf(track);
  const t = clampAutomationTimeMs(timeMs);
  if (t == null) return project;
  const points = current.points.filter((p) => p.timeMs !== t);
  if (points.length === current.points.length) return project;
  return setTrackVolumeAutomation(project, trackId, { ...current, points });
}

export function moveVolumeAutomationPoint(
  project: Project,
  trackId: TrackId,
  fromTimeMs: number,
  timeMs: number,
  value: number,
): { project: Project; point?: VolumeAutomationPoint } {
  const track = trackById(project, trackId);
  if (!track || kindOfTrack(trackId) !== "audio") return { project };
  const current = volumeAutomationOf(track);
  const from = clampAutomationTimeMs(fromTimeMs);
  const point = sanitizeVolumeAutomationPoint({ timeMs, value });
  if (from == null || point == null) return { project };
  if (!current.points.some((p) => p.timeMs === from)) return { project };
  const points = sortVolumeAutomationPoints([
    ...current.points.filter((p) => p.timeMs !== from && p.timeMs !== point.timeMs),
    point,
  ]);
  const next = setTrackVolumeAutomation(project, trackId, { ...current, points });
  return { project: next, point };
}

function pointsEqual(a: readonly VolumeAutomationPoint[], b: readonly VolumeAutomationPoint[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((p, i) => p.timeMs === b[i]!.timeMs && p.value === b[i]!.value);
}

/** Shift project-time points onto an export-local axis (IN = 0). */
export function remapVolumeAutomation(
  automation: VolumeAutomation | undefined,
  startMs: number,
): VolumeAutomation | undefined {
  if (!automation) return undefined;
  const origin = Number.isFinite(startMs) ? startMs : 0;
  return {
    enabled: automation.enabled,
    points: sortVolumeAutomationPoints(automation.points.map((p) => ({ ...p, timeMs: p.timeMs - origin }))),
  };
}

export function scheduleVolumeAutomation(
  param: {
    setValueAtTime(value: number, time: number): unknown;
    linearRampToValueAtTime(value: number, time: number): unknown;
  },
  automation: VolumeAutomation | undefined | null,
  clipStartMs: number,
  clipEndMs: number,
): boolean {
  if (!volumeAutomationIsActive(automation)) return false;
  const start = Math.max(0, clipStartMs);
  const end = Math.max(start + 1, clipEndMs);
  const times = new Set<number>([start, end]);
  for (const point of automation!.points) {
    if (point.timeMs > start && point.timeMs < end) times.add(point.timeMs);
  }
  const sorted = [...times].sort((a, b) => a - b);
  sorted.forEach((t, i) => {
    const value = automationValueAt(automation, t);
    const sec = t / 1000;
    if (i === 0) param.setValueAtTime(value, sec);
    else param.linearRampToValueAtTime(value, sec);
  });
  return true;
}
