/**
 * AI-0 contract schemas — tool definitions and first-catalogue I/O.
 * Handlers must call existing applyCommand / session apply* / core functions.
 * Do not duplicate timeline math.
 */

import type { Clip, Project, TrackId } from "../../../src/core/models";
import type { VolumeAutomationPoint } from "../../../src/core/volume-automation";
import type { AudioAnalysisSummary, ClipContext, ProjectSummary, SelectionContext } from "./context";
import type { AIGrant, ToolRiskClass } from "./grants";

export interface JsonSchema {
  type?: string;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  additionalProperties?: boolean;
  description?: string;
  items?: JsonSchema;
  enum?: readonly (string | number)[];
  minimum?: number;
  maximum?: number;
}

export interface ResonanceToolDefinition {
  name: string;
  description: string;
  inputSchema: JsonSchema;
  outputSchema: JsonSchema;
  requiredGrant: AIGrant;
  mutatesProject: boolean;
  supportsPreview: boolean;
  supportsUndo: boolean;
  riskClass: ToolRiskClass;
}

/** V5.6 times are ms. Tool JSON in the architecture spec uses seconds — convert at the adapter. */
export interface SecondsBoundary {
  /** Architecture-spec seconds. Adapter: Math.round(seconds * 1000) → startMs. */
  seconds: number;
  milliseconds: number;
}

export interface ProjectDescribeOutput {
  project: ProjectSummary;
}

export interface TimelineDescribeOutput {
  projectId: Project["id"];
  durationMs: number;
  playheadMs: Project["playheadMs"];
  tracks: ReadonlyArray<{ id: TrackId; kind: "video" | "audio"; name: string; clipCount: number }>;
  clipIds: ReadonlyArray<Clip["id"]>;
}

export interface TimelineGetSelectionInput {
  /** No input. Selection is Session view state, not Project. */
}

export interface TimelineGetSelectionOutput {
  selection: SelectionContext;
}

export interface TimelineGetClipInput {
  clipId: Clip["id"];
}

export interface TimelineGetClipOutput {
  clip: ClipContext;
}

export interface AudioGetAnalysisInput {
  clipId?: Clip["id"];
  /** If omitted, first audible audio clip at playhead — analysisAudioClipAt. */
  timeMs?: number;
}

export interface AudioGetAnalysisOutput {
  analysis: AudioAnalysisSummary | null;
}

export interface AutomationReadInput {
  trackId: TrackId;
  startMs?: number;
  endMs?: number;
}

export interface AutomationReadOutput {
  trackId: TrackId;
  enabled: boolean;
  points: VolumeAutomationPoint[];
}

export interface TimelineMoveClipInput {
  clipId: Clip["id"];
  /** Architecture spec uses seconds. V5.6 moveClip uses startMs. */
  targetStartSeconds: number;
}

export interface TimelineMoveClipDraft {
  clipId: Clip["id"];
  fromStartMs: number;
  toStartMs: number;
  deltaMs: number;
}

export const INITIAL_READ_TOOLS: readonly ResonanceToolDefinition["name"][] = [
  "project.describe",
  "timeline.describe",
  "timeline.get_selection",
  "timeline.get_clip",
  "audio.get_analysis",
  "automation.read",
];

export const FIRST_MUTATION_TOOL: ResonanceToolDefinition["name"] = "timeline.move_clip";
