/**
 * AI-0 contract barrel. Type-only. No providers, MCP server, or Director UI.
 */

export type {
  AIGrant,
  AIGrantSet,
  AIHighRiskGrant,
  ApprovalPolicy,
  DirectorMode,
  ToolRiskClass,
} from "./grants";
export { DEFAULT_GRANT_POLICIES } from "./grants";

export type { NormalizedAIError, NormalizedAIErrorCode } from "./errors";

export type {
  AudioAnalysisSummary,
  ClipContext,
  ContextDataClass,
  ContextPrivacyClassification,
  ContextScope,
  ContextSnapshot,
  PlayheadContext,
  ProjectSummary,
  SelectionContext,
  TrackContext,
} from "./context";

export type {
  AudioGetAnalysisInput,
  AudioGetAnalysisOutput,
  AutomationReadInput,
  AutomationReadOutput,
  JsonSchema,
  ProjectDescribeOutput,
  ResonanceToolDefinition,
  SecondsBoundary,
  TimelineDescribeOutput,
  TimelineGetClipInput,
  TimelineGetClipOutput,
  TimelineGetSelectionInput,
  TimelineGetSelectionOutput,
  TimelineMoveClipDraft,
  TimelineMoveClipInput,
} from "./tools";
export { FIRST_MUTATION_TOOL, INITIAL_READ_TOOLS } from "./tools";

export type { AIAuditEntry, AIJob, AITransaction, AITransactionStatus } from "./transaction";

export type {
  AIProvider,
  AIRequest,
  AIResponse,
  ModelCapabilities,
  ModelInfo,
  NormalizedToolCall,
  ProviderNeutralMessage,
  ProviderNeutralRole,
  StreamCallbacks,
  UsageInfo,
} from "./provider";

export type { ContextReference, TimelineReference } from "./references";
