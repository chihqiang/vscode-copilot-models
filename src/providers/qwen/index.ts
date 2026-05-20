/**
 * Qwen (通义千问) 模型提供者模块
 */

import { ApiRequest, ClientOptions, CONFIG_SECTION, createApiClient, createGenericProviderFactory, ModelDefinition, ThinkingEffort } from "../../core";

// ── 模型定义 ──────────────────────────────────────────

export const QWEN_MODELS: ModelDefinition[] = [
  {
    id: "qwen3-max",
    name: "Qwen3 Max",
    family: "qwen",
    version: "3",
    detail: "Flagship model with advanced reasoning capabilities",
    maxInputTokens: 128000,
    maxOutputTokens: 64000,
    capabilities: {
      toolCalling: true,
      imageInput: true,
      thinking: true,
    },
    requiresThinkingParam: true,
  },
  {
    id: "qwen3.6-plus",
    name: "Qwen3.6 Plus",
    family: "qwen",
    version: "3.6",
    detail: "Enhanced model with improved performance",
    maxInputTokens: 128000,
    maxOutputTokens: 64000,
    capabilities: {
      toolCalling: true,
      imageInput: true,
      thinking: true,
    },
    requiresThinkingParam: true,
  },
  {
    id: "qwen3.5-flash",
    name: "Qwen3.5 Flash",
    family: "qwen",
    version: "3.5",
    detail: "Fast inference model for quick responses",
    maxInputTokens: 128000,
    maxOutputTokens: 64000,
    capabilities: {
      toolCalling: true,
      imageInput: true,
      thinking: true,
    },
    requiresThinkingParam: true,
  },
];

export const QWEN_PROVIDER_ID = "qwen";

export const QWEN_DEFAULT_BASE_URL = "https://dashscope.aliyuncs.com/compatible-mode/v1";

// ── Provider 注册 ─────────────────────────────────────
const { register } = createGenericProviderFactory({
  providerId: QWEN_PROVIDER_ID,
  providerName: "Qwen",
  defaultBaseUrl: QWEN_DEFAULT_BASE_URL,
  models: QWEN_MODELS,
  apiKeyPrompt: "Enter your Qwen API Key",
  apiKeyPlaceholder: "Qwen API Key",
  configSection: CONFIG_SECTION,
  createClient: function (
    baseUrl: string,
    apiKey: string,
    options?: ClientOptions,
  ) {
    return createApiClient({
      baseUrl,
      apiKey,
      providerName: "Qwen",
      timeoutMs: options?.timeoutMs ?? 60_000,
      maxRetries: options?.maxRetries ?? 1,
    });
  },
  convertThinkingParams: (request: ApiRequest, effort: ThinkingEffort) => {
    if (effort !== "none") {
      request.reasoning_effort = effort;
    }
  },
});

export function registerQwenProviderFactory(): void {
  register();
}