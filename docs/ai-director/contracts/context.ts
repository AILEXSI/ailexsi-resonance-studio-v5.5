/**
 * AI-0 contract schemas — context snapshots.
 * Times are milliseconds (V5.6 canonical). Tool adapters convert seconds at the boundary.
 * Reuses Project / Clip / TrackId / VisualizerSceneId / AudioFeatures / VolumeAutomation.
 */

import type { Clip, Marker, Project, Track, TrackId } from "../../../src/core/models";
import type { VisualizerSceneId } from "../../../src/core/visualz/scene-catalog";
import type { AudioFeatures } from "../../../src/core/visualz/types";
import type { VolumeAutomation } from "../../../src/core/volume-automation";

export type ContextScope = "NONE" | "SELECTION" | "PLAYHEAD" | "TRACK" | "PROJECT" | "CUSTOM";

export type ContextPrivacyClassification =
  | "LOCAL_ONLY"
  | "ASK_BEFORE_EXTERNAL"
  | "EXTERNAL_ALLOWED";

export type ContextDataClass = "SEND_TEXT" | "SEND_METADATA" | "SEND_IMAGES" | "SEND_AUDIO" | "SEND_VIDEO";

/** Compact project summary. Revision is proposed (ADR-001); Project has no projectRevision today. */
export interface ProjectSummary {
  id: Project["id"];
  name: Project["name"];
  schemaVersion: Project["schemaVersion"];
  durationMs: number;
  trackCount: number;
  clipCount: number;
  /** Proposed monotonic revision. Missing until AI-6. */
  revision: number;
  updatedAt: Project["updatedAt"];
}

export interface SelectionContext {
  clipIds: ReadonlyArray<Clip["id"]>;
  trackIds: readonly TrackId[];
  visEventIds: readonly string[];
  markerId: Marker["id"] | null;
  /** Inclusive range of selected clips, if any. */
  startMs: number | null;
  endMs: number | null;
}

export interface PlayheadContext {
  playheadMs: Project["playheadMs"];
  inPointMs: Project["inPointMs"];
  outPointMs: Project["outPointMs"];
  playing: boolean;
}

export interface TrackContext {
  id: Track["id"];
  kind: Track["kind"];
  name: Track["name"];
  muted: Track["muted"];
  solo: Track["solo"];
  volume: Track["volume"];
  pan: Track["pan"];
  groupId: Track["groupId"];
  volumeAutomation?: VolumeAutomation;
}

export interface ClipContext {
  id: Clip["id"];
  assetId: Clip["assetId"];
  trackId: Clip["trackId"];
  startMs: Clip["startMs"];
  durationMs: Clip["durationMs"];
  sourceInMs: Clip["sourceInMs"];
  sourceOutMs: Clip["sourceOutMs"];
  gain: Clip["gain"];
  fadeInMs: Clip["fadeInMs"];
  fadeOutMs: Clip["fadeOutMs"];
  rate: Clip["rate"];
  linkId: Clip["linkId"];
  enabled: Clip["enabled"];
  locked: Clip["locked"];
}

export interface AudioAnalysisSummary {
  clipId: Clip["id"];
  assetId: Clip["assetId"];
  timeMs: AudioFeatures["timeMs"];
  rms: AudioFeatures["rms"];
  bass: AudioFeatures["bass"];
  mid: AudioFeatures["mid"];
  treble: AudioFeatures["treble"];
  onset: AudioFeatures["onset"];
  beatPulse: AudioFeatures["beatPulse"];
  tempoBpm: AudioFeatures["tempoBpm"];
  /** Spectrum omitted from default snapshots — large and live-path only. */
}

export interface ContextSnapshot {
  id: string;
  projectId: Project["id"];
  /** Proposed revision identity. See ADR-001. */
  projectRevision: number;
  createdAt: number;
  scopes: ContextScope[];
  projectSummary?: ProjectSummary;
  selection?: SelectionContext;
  playhead?: PlayheadContext;
  tracks?: TrackContext[];
  clips?: ClipContext[];
  audioAnalysis?: AudioAnalysisSummary[];
  visSceneId?: VisualizerSceneId;
  privacyClassification: ContextPrivacyClassification;
}
