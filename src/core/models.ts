/** VS Code configuration section prefix */
export const CONFIG_SECTION = "copilot-models";

/**
 * Vendor ID of the router entry point registered with VS Code.
 *
 * It is a second language model provider, and the ID has to match the
 * `contributes.languageModelChatProviders` entry in package.json — which
 * cannot import this file. `identifiers.test.ts` compares the two.
 */
export const ROUTER_VENDOR_ID = "copilot-models-router";

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
 * How a provider turns thinking on and off.
 *
 * The APIs disagree, and getting it wrong is silent: a parameter the API
 * ignores leaves thinking at its default rather than reporting a problem.
 *
 * - `reasoning_effort`: one parameter carries both. `none` turns thinking
 *   off, and `low` / `high` / `max` turn it on at that effort.
 * - `thinking_type`: a `thinking.type` toggle for on/off, with the effort
 *   level — where the API has one — left at the API's own default.
 * - `enable_thinking`: an `enable_thinking` boolean toggle, which is what
 *   DashScope documents. Thinking is on by default there, so the boolean has
 *   to be sent as `false` to turn it off.
 */
export type ThinkingFormat =
  | "reasoning_effort"
  | "thinking_type"
  | "enable_thinking";

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
  thinkingFormat?: ThinkingFormat;
  models: ModelDefinition[];
}
