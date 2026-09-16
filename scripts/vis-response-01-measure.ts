/**
 * VIS-RESPONSE-01 Phase 1 — measure raw analyser + scene-consumed packets
 * on deterministic reference PCM. Does not change production code.
 *
 * Run: npx vitest run --config vite.config.ts scripts/vis-response-01-measure.ts
 * (or: node --experimental-strip-types if available)
 */
import {
  createExportFeatureSession,
  visFeaturesForExport,
  visFeaturesForPreview,
  type MixPcm,
  type VisualizerFeatures,
} from "../src/core/visualizer";
import { createOfflineFeatureExtractor } from "../src/core/visualz/feature-extractor";
import { applyVisResponse } from "../src/core/visualz/vis-response";

const SR = 44100;

function pcm(data: Float32Array, sampleRate = SR): MixPcm {
  return {
    sampleRate,
    length: data.length,
    numberOfChannels: 1,
    getChannelData: () => data,
  } as MixPcm;
}

function silence(durationMs: number): Float32Array {
  return new Float32Array(Math.round((SR * durationMs) / 1000));
}

function sineAt(freqHz: number, durationMs: number, amp: number): Float32Array {
  const n = Math.round((SR * durationMs) / 1000);
  const data = new Float32Array(n);
  for (let i = 0; i < n; i++) data[i] = amp * Math.sin((2 * Math.PI * freqHz * i) / SR);
  return data;
}

function kickAt(data: Float32Array, timeMs: number, amp = 0.95): void {
  const start = Math.round((timeMs / 1000) * SR);
  const clickN = Math.round(SR * 0.012);
  for (let i = 0; i < clickN && start + i < data.length; i++) {
    const env = 1 - i / clickN;
    const t = i / SR;
    data[start + i] =
      env * amp * (0.95 * Math.sin(2 * Math.PI * 70 * t) + 0.3 * Math.sin(2 * Math.PI * 160 * t));
  }
}

function snareAt(data: Float32Array, timeMs: number, amp = 1): void {
  const start = Math.round((timeMs / 1000) * SR);
  const clickN = Math.round(SR * 0.008);
  let seed = 1;
  for (let i = 0; i < clickN && start + i < data.length; i++) {
    seed = (seed * 16807) % 2147483647;
    const noise = (seed / 2147483647) * 2 - 1;
    const env = 1 - i / clickN;
    const t = i / SR;
    data[start + i] = env * amp * (0.55 * noise + 0.35 * Math.sin(2 * Math.PI * 220 * t));
  }
}

function scaleAmp(data: Float32Array, gain: number): Float32Array {
  const out = new Float32Array(data.length);
  for (let i = 0; i < data.length; i++) out[i] = (data[i] ?? 0) * gain;
  return out;
}

function specStats(spec: ArrayLike<number>) {
  const n = spec.length;
  let sum = 0;
  let peak = 0;
  let peakK = 0;
  let above05 = 0;
  let above15 = 0;
  let above30 = 0;
  const copy: number[] = [];
  for (let i = 0; i < n; i++) {
    const v = spec[i] ?? 0;
    copy.push(v);
    sum += v;
    if (v > peak) {
      peak = v;
      peakK = i;
    }
    if (v > 0.05) above05++;
    if (v > 0.15) above15++;
    if (v > 0.3) above30++;
  }
  copy.sort((a, b) => a - b);
  const pct = (p: number) => copy[Math.min(n - 1, Math.floor(p * (n - 1)))] ?? 0;
  return {
    bins: n,
    mean: sum / Math.max(1, n),
    peak,
    peakK,
    p50: pct(0.5),
    p90: pct(0.9),
    p99: pct(0.99),
    above05,
    above15,
    above30,
  };
}

function sceneConsumed(f: VisualizerFeatures) {
  return {
    orbBreath: 1 + f.bass * 0.55,
    orbFlash: f.onset ? 1.35 : 1 + f.beatPulse * 0.45,
    auroraBreath: 0.42 + f.bass * 0.55,
    barsPow: Math.pow(f.spectrum[8] ?? 0, 0.85),
    barsPeakPow: Math.pow(
      Math.max(0, ...Array.from({ length: Math.min(48, f.spectrum.length) }, (_, i) => {
        const idx = Math.floor((i / 47) * Math.max(0, f.spectrum.length - 1));
        return f.spectrum[idx] ?? 0;
      })),
      0.85,
    ),
    waveCore: 6 + f.bass * 18 + f.beatPulse * 10,
    beatGate02: f.beatPulse > 0.2,
    beatGate04: f.beatPulse > 0.4,
  };
}

function pack(label: string, raw: ReturnType<ReturnType<typeof createOfflineFeatureExtractor>["sample"]>, vis: VisualizerFeatures) {
  const spec = specStats(raw.spectrum);
  const visSpec = specStats(vis.spectrum);
  return {
    label,
    raw: {
      rms: +raw.rms.toFixed(4),
      bass: +raw.bass.toFixed(4),
      mid: +raw.mid.toFixed(4),
      treble: +raw.treble.toFixed(4),
      energy: +(raw.rms * 0.5 + raw.bass * 0.5).toFixed(4),
      onset: raw.onset,
      beatPulse: +raw.beatPulse.toFixed(4),
      specMean: +spec.mean.toFixed(4),
      specPeak: +spec.peak.toFixed(4),
      specPeakK: spec.peakK,
      specP90: +spec.p90.toFixed(4),
      specP99: +spec.p99.toFixed(4),
      specAbove05: spec.above05,
      specAbove15: spec.above15,
      specAbove30: spec.above30,
    },
    scene: {
      rms: +vis.rms.toFixed(4),
      bass: +vis.bass.toFixed(4),
      mid: +vis.mid.toFixed(4),
      treble: +vis.treble.toFixed(4),
      energy: +vis.energy.toFixed(4),
      high: +vis.high.toFixed(4),
      onset: vis.onset,
      beatPulse: +vis.beatPulse.toFixed(4),
      specMean: +visSpec.mean.toFixed(4),
      specPeak: +visSpec.peak.toFixed(4),
      ...Object.fromEntries(
        Object.entries(sceneConsumed(vis)).map(([k, v]) => [k, typeof v === "number" ? +v.toFixed(4) : v]),
      ),
    },
  };
}

function sequentialAt(buf: MixPcm, timeMs: number) {
  const rawEx = createOfflineFeatureExtractor(buf);
  const vis = visFeaturesForExport(timeMs, 4000, buf);
  const hop = 1000 / 60;
  let raw = rawEx.sample(0);
  for (let t = hop; t <= timeMs + 1e-6; t += hop) raw = rawEx.sample(t);
  raw = rawEx.sample(timeMs);
  const presented = applyVisResponse(raw);
  return { ...pack("seq", raw, vis), shapedFromRaw: pack("shaped", raw, presented).scene };
}

function measureRefs() {
  const rows: ReturnType<typeof pack>[] = [];

  const sil = pcm(silence(800));
  rows.push({ ...sequentialAt(sil, 400), label: "silence" });

  const quietPad = pcm(sineAt(220, 800, 0.06));
  rows.push({ ...sequentialAt(quietPad, 400), label: "quiet-sustained-220hz-amp0.06" });

  const med = pcm(sineAt(220, 800, 0.35));
  rows.push({ ...sequentialAt(med, 400), label: "medium-pad-220hz-amp0.35" });

  const kickData = silence(800);
  kickAt(kickData, 240, 0.95);
  rows.push({ ...sequentialAt(pcm(kickData), 260), label: "strong-kick-70hz" });

  const snareData = silence(800);
  snareAt(snareData, 240, 1);
  rows.push({ ...sequentialAt(pcm(snareData), 256), label: "strong-snare" });

  const bass = pcm(sineAt(55, 800, 0.55));
  rows.push({ ...sequentialAt(bass, 400), label: "bass-heavy-55hz-amp0.55" });

  // Known VIS-SYNC-01 song marks (same as parity test).
  const song = silence(2000);
  kickAt(song, 400);
  snareAt(song, 720);
  const sus0 = Math.round(SR);
  const susN = Math.round(0.5 * SR);
  for (let i = 0; i < susN && sus0 + i < song.length; i++) {
    song[sus0 + i] = 0.35 * Math.sin((2 * Math.PI * 220 * i) / SR);
  }
  const songBuf = pcm(song);
  const session = createExportFeatureSession(songBuf, { hopMs: 1000 / 60 });
  const marks = { quiet: 80, kick: 420, snare: 736, pad: 1200 };
  for (const [name, t] of Object.entries(marks)) {
    const vis = session.sample(t);
    const rawEx = createOfflineFeatureExtractor(pcm(song));
    let raw = rawEx.sample(0);
    for (let u = 1000 / 60; u <= t + 1e-6; u += 1000 / 60) raw = rawEx.sample(u);
    raw = rawEx.sample(t);
    rows.push({ ...pack(name, raw, vis), label: `known-song-${name}` });
  }

  // Amplitude sweep for monotonicity of RAW (baseline).
  const sweep: { amp: number; rms: number; bass: number; energy: number; specPeak: number }[] = [];
  for (let a = 0; a <= 1.001; a += 0.1) {
    const amp = +a.toFixed(1);
    const buf = pcm(sineAt(110, 600, amp));
    const vis = visFeaturesForExport(250, 600, buf);
    sweep.push({
      amp,
      rms: +vis.rms.toFixed(4),
      bass: +vis.bass.toFixed(4),
      energy: +vis.energy.toFixed(4),
      specPeak: +Math.max(0, ...Array.from(vis.spectrum)).toFixed(4),
    });
  }

  const preview = visFeaturesForPreview({
    timeMs: 400,
    durationMs: 800,
    mix: med,
    audioLoaded: true,
    hasClipAtPlayhead: true,
  });
  const exported = visFeaturesForExport(400, 800, med);

  return { rows, sweep, previewEq: preview.rms === exported.rms, previewRms: preview.rms, exportRms: exported.rms };
}

const result = measureRefs();
console.log(JSON.stringify(result, null, 2));
