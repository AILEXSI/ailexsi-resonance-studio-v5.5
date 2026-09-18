/**
 * AI-0 contract schemas — normalized errors.
 * Provider-specific strings must never leak into Session / Project handling.
 */

export type NormalizedAIErrorCode =
  | "PROVIDER_UNAVAILABLE"
  | "AUTH_FAILED"
  | "RATE_LIMIT"
  | "MODEL_UNAVAILABLE"
  | "CONTEXT_LIMIT"
  | "TOOL_UNSUPPORTED"
  | "PROVIDER_BAD_RESPONSE"
  | "TIMEOUT"
  | "CANCELLED"
  | "PERMISSION_DENIED"
  | "PRIVACY_DENIED"
  | "SCHEMA_INVALID"
  | "TARGET_NOT_FOUND"
  | "AMBIGUOUS_TARGET"
  | "SEMANTIC_VALIDATION_FAILED"
  | "PROJECT_CHANGED"
  | "TRANSACTION_CONFLICT"
  | "TRANSACTION_FAILED"
  | "ROLLBACK_FAILED"
  | "JOB_FAILED"
  | "MEDIA_OFFLINE"
  | "UNSUPPORTED_OPERATION"
  | "CLIP_LOCKED"
  | "TRACK_KIND_MISMATCH";

export interface NormalizedAIError {
  code: NormalizedAIErrorCode;
  message: string;
  /** Stable target id when the failure is object-specific. */
  targetId?: string;
  /** Proposed V5.6 revision identity — see ADR-001. Not a Project field today. */
  baseRevision?: number;
  currentRevision?: number;
  details?: Record<string, string | number | boolean | null>;
}
