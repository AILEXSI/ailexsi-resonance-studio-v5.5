/**
 * AI-0 contract schemas — provider-neutral request/response boundary.
 * No vendor SDK, no runtime adapter. Chat-only until AI-2.
 */

import type { ContextSnapshot } from "./context";
import type { NormalizedAIError } from "./errors";
import type { ResonanceToolDefinition } from "./tools";

export type ProviderNeutralRole = "user" | "assistant" | "system" | "tool";

export interface ProviderNeutralMessage {
  id: string;
  role: ProviderNeutralRole;
  content: string;
  timestamp: number;
  toolCallIds?: string[];
}

export interface ModelCapabilities {
  text: boolean;
  vision: boolean;
  audioInput: boolean;
  videoInput: boolean;
  nativeToolCalling: boolean;
  structuredOutput: boolean;
  reasoning: boolean;
  streaming: boolean;
  maxContextTokens?: number;
}

export interface ModelInfo {
  id: string;
  name: string;
  capabilities?: ModelCapabilities;
}

export interface UsageInfo {
  inputTokens?: number;
  outputTokens?: number;
  cachedTokens?: number;
  latencyMs?: number;
  estimatedCost?: number;
}

export interface NormalizedToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface AIRequest {
  requestId: string;
  conversationId: string;
  modelId: string;
  messages: ProviderNeutralMessage[];
  tools: ResonanceToolDefinition[];
  context: ContextSnapshot;
  responseMode: "text" | "structured" | "tool-capable";
  cancellationToken?: string;
}

export interface AIResponse {
  requestId: string;
  text?: string;
  toolCalls?: NormalizedToolCall[];
  usage?: UsageInfo;
  finishReason: string;
  error?: NormalizedAIError;
}

export interface StreamCallbacks {
  onTextDelta?(delta: string): void;
  onToolCall?(call: NormalizedToolCall): void;
  onError?(error: NormalizedAIError): void;
}

/**
 * Provider interface — schema only. Do not implement adapters in AI-0.
 * First implementation must not live in timeline / playback / AFE / exporter modules.
 */
export interface AIProvider {
  readonly id: string;
  readonly name: string;
  getModels(): Promise<ModelInfo[]>;
  getCapabilities(modelId: string): Promise<ModelCapabilities>;
  testConnection(): Promise<{ state: "DISCONNECTED" | "CONNECTING" | "CONNECTED" | "AUTH_FAILED" | "UNAVAILABLE" }>;
  chat(request: AIRequest): Promise<AIResponse>;
  stream(request: AIRequest, callbacks: StreamCallbacks): Promise<AIResponse>;
  abort(requestId: string): Promise<void>;
}
