/** AFE-03 local benchmark helpers. Not shipped. */

export type WallStats = {
  n: number;
  mean: number;
  median: number;
  p50: number;
  p95: number;
  worst: number;
  min: number;
  stddev: number;
};

export function wallStats(values: number[]): WallStats {
  const s = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  const n = s.length;
  if (n === 0) return { n: 0, mean: 0, median: 0, p50: 0, p95: 0, worst: 0, min: 0, stddev: 0 };
  const sum = s.reduce((a, b) => a + b, 0);
  const mean = sum / n;
  const median = n % 2 === 1 ? s[(n - 1) >> 1]! : (s[n / 2 - 1]! + s[n / 2]!) / 2;
  const p95 = s[Math.min(n - 1, Math.max(0, Math.ceil(n * 0.95) - 1))]!;
  let varSum = 0;
  for (const v of s) varSum += (v - mean) * (v - mean);
  const stddev = Math.sqrt(varSum / n);
  return { n, mean, median, p50: median, p95, worst: s[n - 1]!, min: s[0]!, stddev };
}

export function clipOf(
  id: string,
  url: string,
  startMs: number,
  endMs: number,
  extra: Record<string, unknown> = {},
) {
  return {
    id,
    trackId: "V1",
    kind: "video",
    startMs,
    endMs,
    sourceUrl: url,
    sourceInMs: 0,
    sourceOutMs: endMs - startMs,
    gain: 1,
    fadeInMs: 0,
    fadeOutMs: 0,
    rate: 1,
    missing: false,
    label: id,
    ...extra,
  };
}

export function jobOf(
  id: string,
  _url: string,
  width: number,
  height: number,
  durationMs: number,
  fps: number,
  clips: ReturnType<typeof clipOf>[],
  extra: Record<string, unknown> = {},
) {
  return {
    id,
    projectId: "p",
    projectName: "afe-03",
    startMs: 0,
    endMs: durationMs,
    durationMs,
    width,
    height,
    fps,
    fileName: `${id}.mp4`,
    tracks: [{ id: "V1", kind: "video", pan: 0, clips }],
    visualizer: { enabled: false, muted: true, sceneId: "spectrum-bars" },
    ...extra,
  };
}
