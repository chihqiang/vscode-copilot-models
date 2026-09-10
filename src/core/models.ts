/** VS Code configuration section prefix */
export const CONFIG_SECTION = "copilot-models";

/** Routing strategy */
export type RoutingStrategy = "failover" | "latency";

/**
 * Model capabilities definition
 */
export interface ModelCapabilities {
  /** Whether tool calling is supported */
  toolCalling: boolean;
  /** Whether image input is supported */
  imageInput: boolean;
  /** Whether thinking mode (reasoning) is supported */
  thinking: boolean;
}

/**
 * Model definition interface
 */
export interface ModelDefinition {
  /** Model unique identifier (ID in VS Code) */
  id: string;
  /** Model display name */
  name: string;
  /** Model family (e.g. deepseek, openai) */
  family: string;
  /** Model version */
  version: string;
  /** Model detail description */
  detail: string;
  /** Maximum input tokens */
  maxInputTokens: number;
  /** Maximum output tokens */
  maxOutputTokens: number;
  /** Model capabilities */
  capabilities: ModelCapabilities;
}

/**
 * Provider definition — pure data describing a vendor's config and models.
 * Lives in models.ts (data-only) so both provider-models.ts and
 * model-provider.ts can consume it without circular imports.
 */
export interface ProviderDefinition {
  id: string;
  name: string;
  defaultBaseUrl: string;
  apiKeyPrompt: string;
  apiKeyPlaceholder: string;
  supportsThinking?: boolean;
  thinkingFormat?: "reasoning_effort" | "thinking_type";
  models: ModelDefinition[];
}
