/**
 * AUDIO-01 export stage trail + metrics.
 * Separate from STRESS-03 video stage-trace. Reporting only — does not
 * change AFE scheduling, mux, or encoder selection.
 */

import { ailexsiBuildIdentity } from "../build-info";

export const AUDIO_STAGE_NAMES = [
  "AUDIO_EXPECTATION_EVALUATED",
  "AUDIO_CLIPS_DISCOVERED",
  "AUDIO_MIX_BEGIN",
  "AUDIO_DECODE_BEGIN",
  "AUDIO_DECODE_DONE",
  "AUDIO_MIX_RENDER_BEGIN",
  "AUDIO_MIX_RENDER_DONE",
  "AUDIO_MIX_DONE",
  "AAC_PROBE_BEGIN",
  "AAC_PROBE_DONE",
  "AAC_ENCODE_BEGIN",
  "AAC_ENCODE_FLUSH_BEGIN",
  "AAC_ENCODE_FLUSH_DONE",
  "AAC_ENCODE_DONE",
  "AUDIO_TRACK_READY",
  "AUDIO_MUX_BEGIN",
  "AUDIO_MUX_DONE",
  "AUDIO_TRACK_VALIDATED",
] as const;

export type AudioStageName = (typeof AUDIO_STAGE_NAMES)[number];

export type AudioTrackSnapshot = {
  id: string;
  kind: string;
  muted: boolean | null;
  solo: boolean | null;
  volume: number | null;
  pan: number;
  clipCount: number;
};

export type AudioStageEntry = {
  stage: AudioStageName;
  elapsedMs: number;
  atMs: number;
};

export type AudioExportReport = {
  productVersion: string;
  gitSha: string;
  branch: string;
  projectDurationMs: number;
  exportStartMs: number;
  exportEndMs: number;
  expectsAudio: boolean;
  clipCount: number;
  trackCount: number;
  tracks: AudioTrackSnapshot[];
  sampleRate: number | null;
  channels: number | null;
  bitrate: number | null;
  offlineFrameLength: number | null;
  mixedBufferLength: number | null;
  mixedDurationSec: number | null;
  mixElapsedMs: number | null;
  aacInputFrames: number | null;
  aacOutputCount: number | null;
  descriptionBytes: number | null;
  encodedBytes: number | null;
  aacElapsedMs: number | null;
  mp4AudioSupplied: boolean | null;
  mp4HasAudioTrack: boolean | null;
  resultAudio: "aac" | "none" | null;
  stages: AudioStageEntry[];
  lastStage: AudioStageName | null;
};

function nowMs(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

function identityDefaults(): Pick<AudioExportReport, "productVersion" | "gitSha" | "branch"> {
  const id = ailexsiBuildIdentity();
  return {
    productVersion: id.productVersion,
    gitSha: id.gitSha,
    branch: id.branch,
  };
}

function emptyReport(): AudioExportReport {
  return {
    ...identityDefaults(),
    projectDurationMs: 0,
    exportStartMs: 0,
    exportEndMs: 0,
    expectsAudio: false,
    clipCount: 0,
    trackCount: 0,
    tracks: [],
    sampleRate: null,
    channels: null,
    bitrate: null,
    offlineFrameLength: null,
    mixedBufferLength: null,
    mixedDurationSec: null,
    mixElapsedMs: null,
    aacInputFrames: null,
    aacOutputCount: null,
    descriptionBytes: null,
    encodedBytes: null,
    aacElapsedMs: null,
    mp4AudioSupplied: null,
    mp4HasAudioTrack: null,
    resultAudio: null,
    stages: [],
    lastStage: null,
  };
}

let originMs: number | null = null;
let report: AudioExportReport = emptyReport();

export function resetAudioExportReport(): void {
  originMs = null;
  report = emptyReport();
}

export function beginAudioExportReport(
  patch: Partial<AudioExportReport> = {},
): AudioExportReport {
  originMs = nowMs();
  report = { ...emptyReport(), ...patch, stages: [], lastStage: null };
  return snapshotAudioExportReport();
}

export function updateAudioExportReport(patch: Partial<AudioExportReport>): AudioExportReport {
  report = { ...report, ...patch };
  return snapshotAudioExportReport();
}

export function markAudioStage(stage: AudioStageName): AudioStageEntry {
  const atMs = nowMs();
  if (originMs == null) originMs = atMs;
  const entry: AudioStageEntry = {
    stage,
    elapsedMs: atMs - originMs,
    atMs,
  };
  const last = report.stages[report.stages.length - 1];
  if (last?.stage === stage) {
    report.stages[report.stages.length - 1] = entry;
  } else {
    report.stages = [...report.stages, entry];
  }
  report.lastStage = stage;
  return entry;
}

export function snapshotAudioExportReport(): AudioExportReport {
  return {
    ...report,
    ...identityDefaults(),
    tracks: report.tracks.map((t) => ({ ...t })),
    stages: report.stages.map((s) => ({ ...s })),
  };
}

export function getAudioExportReport(): AudioExportReport {
  return snapshotAudioExportReport();
}

function token(value: unknown): string {
  if (value === undefined || value === null || value === "") return "n/a";
  if (typeof value === "boolean") return value ? "yes" : "no";
  if (typeof value === "number" && !Number.isFinite(value)) return "n/a";
  return String(value);
}

function roundMs(ms: number): string {
  return (Math.round(ms * 1000) / 1000).toString();
}

export function formatAudioExportReport(input: AudioExportReport = snapshotAudioExportReport()): string {
  const id = ailexsiBuildIdentity();
  const lines: string[] = [
    "AUDIO-01 LONG-FORM AUDIO",
    `productVersion ${input.productVersion || id.productVersion}`,
    `gitSha ${input.gitSha || id.gitSha}`,
    `branch ${input.branch || id.branch}`,
    `projectDurationMs ${token(input.projectDurationMs)}`,
    `exportStartMs ${token(input.exportStartMs)}`,
    `exportEndMs ${token(input.exportEndMs)}`,
    `expectsAudio ${token(input.expectsAudio)}`,
    `clipCount ${token(input.clipCount)}`,
    `trackCount ${token(input.trackCount)}`,
    `tracks ${input.tracks.length === 0 ? "n/a" : input.tracks.map((t) =>
      `${t.id}:${t.kind} mute=${token(t.muted)} solo=${token(t.solo)} vol=${token(t.volume)} pan=${token(t.pan)} clips=${t.clipCount}`,
    ).join(" | ")}`,
    `sampleRate ${token(input.sampleRate)}`,
    `channels ${token(input.channels)}`,
    `bitrate ${token(input.bitrate)}`,
    `offlineFrameLength ${token(input.offlineFrameLength)}`,
    `mixedBufferLength ${token(input.mixedBufferLength)}`,
    `mixedDurationSec ${token(input.mixedDurationSec)}`,
    `mixElapsedMs ${token(input.mixElapsedMs)}`,
    `aacInputFrames ${token(input.aacInputFrames)}`,
    `aacOutputCount ${token(input.aacOutputCount)}`,
    `descriptionBytes ${token(input.descriptionBytes)}`,
    `encodedBytes ${token(input.encodedBytes)}`,
    `aacElapsedMs ${token(input.aacElapsedMs)}`,
    `mp4AudioSupplied ${token(input.mp4AudioSupplied)}`,
    `mp4HasAudioTrack ${token(input.mp4HasAudioTrack)}`,
    `resultAudio ${token(input.resultAudio)}`,
    `lastStage ${token(input.lastStage)}`,
    `stageCount ${input.stages.length}`,
  ];
  if (input.stages.length === 0) {
    lines.push("stageTrail (none)");
  } else {
    lines.push(
      `stageTrail ${input.stages.map((s) => `${s.stage} elapsedMs ${roundMs(s.elapsedMs)}`).join(" | ")}`,
    );
    for (const s of input.stages) {
      lines.push(`${s.stage} elapsedMs ${roundMs(s.elapsedMs)}`);
    }
  }
  return lines.join("\n");
}

/** Raw PCM bytes for stereo Float32 at `sampleRate` for `durationMin` minutes. */
export function pcmBytesForDuration(durationMin: number, sampleRate = 44100, channels = 2): number {
  const frames = Math.max(0, durationMin) * 60 * sampleRate;
  return frames * channels * 4;
}

export function classifyOfflineAudioMemory(durationMin: number): {
  durationMin: number;
  frames: number;
  bytes: number;
  mib: number;
} {
  const frames = Math.max(0, durationMin) * 60 * 44100;
  const bytes = pcmBytesForDuration(durationMin, 44100, 2);
  return {
    durationMin,
    frames,
    bytes,
    mib: bytes / (1024 * 1024),
  };
}
