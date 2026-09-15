import type { FrontVideoTrackId, MediaKind, TrackId, VisualizerEvent, VisualizerSceneId } from "../models";
import type { Transition } from "../transition";

export interface ExportClip {
  id: string;
  trackId: TrackId;
  kind: MediaKind;
  startMs: number;
  endMs: number;
  sourceUrl: string;
  sourceInMs: number;
  sourceOutMs: number;
  gain: number;
  /** Clip gain for picture alpha. Mute/fader/master stay on `gain` (audio). */
  videoGain?: number;
  fadeInMs: number;
  fadeOutMs: number;
  /** Factor at job-local 0 when IN starts mid fade-in (omit = classic 0). */
  fadeInFrom?: number;
  /** Factor at job-local end when OUT ends mid fade-out (omit = classic 0). */
  fadeOutTo?: number;
  rate: number;
  missing: boolean;
  label: string;
  linkId?: string;
  /** Image asset on a video lane — picture only, no decode/mix. */
  still?: boolean;
  /** True when a living linked A mate (enabled, disabled, or muted) carries the sound. */
  skipMix?: boolean;
}

export interface ExportTrack {
  id: TrackId;
  kind: MediaKind;
  /** −1 L … +1 R. Applied last on this track’s mix contribution. */
  pan: number;
  clips: ExportClip[];
  /** Export-local volume envelope. Missing / disabled = identity (prior mix). */
  volumeAutomation?: { enabled: boolean; points: { timeMs: number; value: number }[] };
}

export interface ExportVisualizer {
  enabled: boolean;
  muted: boolean;
  sceneId: VisualizerSceneId;
  startMs?: number;
  durationMs?: number;
  events?: VisualizerEvent[];
}

export interface ExportJob {
  id: string;
  projectId: string;
  projectName: string;
  startMs: number;
  endMs: number;
  durationMs: number;
  width: number;
  height: number;
  fps: number;
  fileName: string;
  tracks: ExportTrack[];
  visualizer: ExportVisualizer;
  /** Job-relative startMs (shifted by export IN). */
  transitions?: Transition[];
  frontVideoTrackId?: FrontVideoTrackId;
}

export interface ExportProgress {
  percent: number;
  stage: string;
  currentTimeMs?: number;
}

export type ExportAudioKind = "aac" | "wav" | "none";

export interface ExportResult {
  success: boolean;
  aborted?: boolean;
  error?: string;
  fileName: string;
  durationMs: number;
  fileSizeBytes: number;
  mimeType?: string;
  blob?: Blob;
  brands?: string[];
  audio?: ExportAudioKind;
}

export interface ExportHooks {
  onProgress?: (progress: ExportProgress) => void;
  signal?: AbortSignal;
}
