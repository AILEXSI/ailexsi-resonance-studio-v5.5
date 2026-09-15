/** Deterministic ≥10,000 frame-request plan for AFE sample-table oracle. */

export function expectedFrameAtSec(timeSec: number, fps: number): number {
  if (!Number.isFinite(timeSec) || timeSec < 0) return 0;
  return Math.max(0, Math.floor(timeSec * fps + 1e-9));
}

export function uniqueTimes(values: number[]): number[] {
  const out: number[] = [];
  for (const v of values) {
    if (!Number.isFinite(v)) continue;
    if (out.some((x) => Math.abs(x - v) < 1e-6)) continue;
    out.push(v);
  }
  return out;
}

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a += 0x6d2b79f5;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type AfeFixtureFile = {
  id: string;
  path: string;
  fps: number;
  seconds: number;
  frames: number;
  gop: number;
  keyframeSec: number[];
  width?: number;
  height?: number;
};

export type AfeManifest = {
  width: number;
  height: number;
  files: AfeFixtureFile[];
};

export type AfeRequestRow = {
  file: string;
  path: string;
  fps: number;
  gop: number;
  frames: number;
  seconds: number;
  width: number;
  height: number;
  keyframeSec: number[];
  requestedSec: number;
  expectedFrame: number;
  pattern: string;
};

function sourceTimeSec(
  clip: { startMs: number; sourceInMs: number; sourceOutMs?: number; rate?: number },
  timelineMs: number,
  fps: number,
): number {
  const srcIn = clip.sourceInMs ?? 0;
  const offset = Math.max(0, timelineMs - clip.startMs);
  let srcMs = srcIn + offset * (clip.rate ?? 1) + 500 / Math.max(1, fps);
  if (clip.sourceOutMs != null && clip.sourceOutMs > srcIn) {
    srcMs = Math.min(srcMs, clip.sourceOutMs - 1);
  }
  return Math.max(0, srcMs / 1000);
}

export function probeTimes(file: AfeFixtureFile): number[] {
  const fps = file.fps;
  const dur = file.seconds;
  const kfs = file.keyframeSec ?? [0];
  const times = [0, 1 / fps];
  for (const kf of kfs) {
    if (kf <= 0) continue;
    times.push(kf - 1 / fps, kf, kf + 1 / fps);
  }
  for (let i = 0; i + 1 < kfs.length; i++) {
    times.push((kfs[i]! + kfs[i + 1]!) / 2);
  }
  if (kfs.length === 1) times.push(dur / 2);
  times.push(Math.max(0, dur - 2 / fps), Math.max(0, dur - 1 / fps));
  if (file.seconds >= 25) times.push(10, 2, 25, 5, 18, 1);
  return uniqueTimes(times.filter((t) => t >= 0 && t < dur - 1e-6));
}

export function sequentialTimes(file: AfeFixtureFile): number[] {
  const out: number[] = [];
  for (let i = 0; i < file.frames; i++) out.push((i + 0.5) / file.fps);
  return out;
}

export function randomTimes(file: AfeFixtureFile, count: number, seed: number): number[] {
  const rand = mulberry32(seed);
  const out: number[] = [];
  const max = Math.max(0, file.seconds - 1 / file.fps);
  for (let i = 0; i < count; i++) out.push(rand() * max);
  return out;
}

export function sourceInOutTimes(file: AfeFixtureFile): number[] {
  const fps = file.fps;
  const clip = {
    startMs: 0,
    sourceInMs: Math.min(2000, (file.seconds * 1000) / 4),
    sourceOutMs: Math.min(file.seconds * 1000 - 1, 4000),
    rate: 2,
  };
  const out: number[] = [];
  for (const timelineMs of [0, 100, 250, 333, 500, 750, 999, 1000, 1500]) {
    const t = sourceTimeSec(clip, timelineMs, fps);
    if (t < file.seconds - 1e-6) out.push(t);
  }
  return out;
}

export function clipRateTimes(file: AfeFixtureFile): number[] {
  const fps = file.fps;
  const out: number[] = [];
  for (const rate of [0.5, 1, 2]) {
    const clip = { startMs: 0, sourceInMs: 0, sourceOutMs: file.seconds * 1000, rate };
    for (let i = 0; i < 20; i++) {
      const t = sourceTimeSec(clip, (i / fps) * 1000, fps);
      if (t < file.seconds - 1e-6) out.push(t);
    }
  }
  return out;
}

export function repeatedSegmentTimes(file: AfeFixtureFile): number[] {
  const fps = file.fps;
  const out: number[] = [];
  const clipA = { startMs: 0, sourceInMs: 0, sourceOutMs: 500, rate: 1 };
  const clipB = { startMs: 800, sourceInMs: 0, sourceOutMs: 500, rate: 1 };
  for (const timelineMs of [0, 100, 200, 400, 800, 900, 1000, 1200]) {
    const clip = timelineMs < 800 ? clipA : clipB;
    const t = sourceTimeSec(clip, timelineMs, fps);
    if (t < file.seconds - 1e-6) out.push(t);
  }
  return out;
}

export function buildRequestPlan(manifest: AfeManifest): AfeRequestRow[] {
  const rows: AfeRequestRow[] = [];
  const files = manifest.files.filter((f) => (f.width ?? 160) <= 160);
  const wide = manifest.files.filter((f) => (f.width ?? 160) > 160);

  const push = (file: AfeFixtureFile, times: number[], pattern: string) => {
    for (const requestedSec of times) {
      if (!Number.isFinite(requestedSec) || requestedSec < 0) continue;
      if (requestedSec >= file.seconds - 1e-6) continue;
      rows.push({
        file: file.id,
        path: file.path,
        fps: file.fps,
        gop: file.gop,
        frames: file.frames,
        seconds: file.seconds,
        width: file.width ?? manifest.width,
        height: file.height ?? manifest.height,
        keyframeSec: file.keyframeSec,
        requestedSec,
        expectedFrame: expectedFrameAtSec(requestedSec, file.fps),
        pattern,
      });
    }
  };

  for (const file of files) {
    push(file, sequentialTimes(file), "sequential");
    push(file, probeTimes(file), "keyframe-boundary");
    push(file, sourceInOutTimes(file), "source-in-out");
    push(file, clipRateTimes(file), "clip-rate");
    push(file, repeatedSegmentTimes(file), "repeated-segment");
    push(file, randomTimes(file, file.seconds >= 20 ? 900 : 280, 0xafe01 + file.frames), "random");
  }

  for (const file of files.filter((f) => f.seconds <= 8)) {
    push(file, sequentialTimes(file), "sequential-repeat");
    push(file, sequentialTimes(file), "sequential-repeat-2");
  }

  const longGop = files.find((f) => f.gop >= 250);
  if (longGop) {
    const extra: number[] = [];
    for (const kf of longGop.keyframeSec ?? []) {
      for (let d = -3; d <= 3; d++) extra.push(kf + d / longGop.fps);
    }
    extra.push(10, 2, 25, 5, 18, 1);
    const rand = mulberry32(0x25060);
    for (let i = 0; i < 1800; i++) extra.push(rand() * (longGop.seconds - 1 / longGop.fps));
    push(longGop, extra.filter((t) => t >= 0 && t < longGop.seconds - 1e-6), "long-gop-mix");
  }

  for (const sec of [0, 0.05, 0.1, 0.2, 0.333, 0.5, 0.75, 1, 1.25, 1.5]) {
    for (const file of files) {
      push(file, [sec], "mixed-fps");
    }
  }

  for (const file of wide) {
    push(file, sequentialTimes(file).slice(0, 8), "export-720p-sample");
  }

  return rows;
}

export function summarizePlan(rows: AfeRequestRow[]) {
  const byPattern: Record<string, number> = {};
  const byFile: Record<string, number> = {};
  for (const row of rows) {
    byPattern[row.pattern] = (byPattern[row.pattern] ?? 0) + 1;
    byFile[row.file] = (byFile[row.file] ?? 0) + 1;
  }
  return { total: rows.length, byPattern, byFile };
}
