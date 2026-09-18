/**
 * AI-0 contract schemas — AI transactions.
 * Commands reuse V5.6 EditorCommand. There is no separate StudioCommand type.
 */

import type { EditorCommand } from "../../../src/app/commands";
import type { Project } from "../../../src/core/models";
import type { NormalizedAIError } from "./errors";

export type AITransactionStatus =
  | "draft"
  | "validated"
  | "preview"
  | "approved"
  | "committed"
  | "rejected"
  | "rolled_back"
  | "failed"
  | "conflicted";

export interface AITransaction {
  id: string;
  conversationId: string;
  projectId: Project["id"];
  providerId: string;
  modelId: string;
  intent: string;
  /** Proposed revision at draft time. Project has no revision field today (ADR-001). */
  baseRevision: number;
  /**
   * Existing V5.6 named commands. Compound AI edits must collapse to one
   * withHistory() snapshot — there is no applyCommandBatch yet (PARTIAL).
   */
  commands: EditorCommand[];
  status: AITransactionStatus;
  createdAt: number;
  committedAt?: number;
  failure?: NormalizedAIError;
}

export interface AIAuditEntry {
  timestamp: number;
  conversationId: string;
  providerId?: string;
  modelId?: string;
  intentRef?: string;
  contextSnapshotId?: string;
  toolName?: string;
  validatedArguments?: Record<string, unknown>;
  permissionResult?: "allow" | "confirm" | "deny";
  transactionId?: string;
  baseRevision?: number;
  commands?: ReadonlyArray<EditorCommand["type"]>;
  approvalResult?: "approved" | "rejected" | "conflicted";
  commitResult?: "committed" | "failed" | "noop";
  resultingRevision?: number;
  error?: NormalizedAIError;
}

export interface AIJob {
  id: string;
  type: string;
  state: "queued" | "running" | "completed" | "failed" | "cancelled";
  progress?: number;
  cancellable: boolean;
  createdAt: number;
}
