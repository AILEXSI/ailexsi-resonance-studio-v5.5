/**
 * AI-0 contract schemas — grants and risk classes.
 * No runtime wiring. Adapt later to a permission service; do not invent a second policy engine.
 */

/** Initial grants from architecture LAW-09 / spec §14. High-risk grants are not implied by EDIT. */
export type AIGrant = "READ" | "DRAFT" | "EDIT" | "EXPORT";

/** Deferred high-risk grants. Never implied by EDIT. */
export type AIHighRiskGrant = "FILESYSTEM" | "NETWORK" | "PLUGIN_CONTROL" | "SCRIPT_EXECUTION";

export type ApprovalPolicy = "AUTO" | "CONFIRM" | "DENY";

export type ToolRiskClass =
  | "read"
  | "draft-edit"
  | "destructive-edit"
  | "export"
  | "history"
  | "high-risk";

export type DirectorMode = "ASK" | "DRAFT" | "AGENT";

export interface AIGrantSet {
  grants: readonly AIGrant[];
  highRisk: readonly AIHighRiskGrant[];
}

export const DEFAULT_GRANT_POLICIES: Record<string, ApprovalPolicy> = {
  "project.describe": "AUTO",
  "timeline.describe": "AUTO",
  "timeline.get_selection": "AUTO",
  "timeline.get_clip": "AUTO",
  "audio.get_analysis": "AUTO",
  "automation.read": "AUTO",
  "timeline.move_clip.draft": "AUTO",
  "timeline.move_clip.commit": "CONFIRM",
  "audio.set_gain.commit": "CONFIRM",
  "delete.media": "DENY",
  "render.preview": "CONFIRM",
  filesystem: "DENY",
  script: "DENY",
};
