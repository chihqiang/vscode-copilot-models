/**
 * BigModel model provider module
 */

import {
  ApiRequest,
  ClientOptions,
  CONFIG_SECTION,
  createApiClient,
  createGenericProviderFactory,
  IProviderFactory,
  ModelDefinition,
  ThinkingEffort,
} from "../../core";

// ── Model Definitions ──────────────────────────────────

export const BIGMODEL_MODELS: ModelDefinition[] = [
  {
    id: "glm-5.2",
    name: "GLM-5.2",
    family: "bigmodel",
    version: "5.2",
    detail: "Latest flagship model, 200K context, enhanced reasoning",
    maxInputTokens: 200000,
    maxOutputTokens: 131072,
    capabilities: {
      toolCalling: true,
      imageInput: false,
      thinking: true,
    },
    requiresThinkingParam: true,
  },
  {
    id: "glm-4.7-flash",
    name: "GLM-4.7-Flash",
    family: "bigmodel",
    version: "4.7",
    detail: "Fast, lightweight model for quick tasks",
    maxInputTokens: 128000,
    maxOutputTokens: 16384,
    capabilities: {
      toolCalling: true,
      imageInput: false,
      thinking: false,
    },
    requiresThinkingParam: false,
  },
  {
    id: "glm-5.1",
    name: "GLM-5.1",
    family: "bigmodel",
    version: "5.1",
    detail: "Flagship base model, 200K context, thinking enabled",
    maxInputTokens: 200000,
    maxOutputTokens: 131072,
    capabilities: {
      toolCalling: true,
      imageInput: false,
      thinking: true,
    },
    requiresThinkingParam: true,
  },
  {
    id: "glm-5-turbo",
    name: "GLM-5-Turbo",
    family: "bigmodel",
    version: "5",
    detail: "Optimized for OpenClaw scenarios, 200K context",
    maxInputTokens: 200000,
    maxOutputTokens: 131072,
    capabilities: {
      toolCalling: true,
      imageInput: false,
      thinking: true,
    },
    requiresThinkingParam: true,
  },
  {
    id: "glm-5",
    name: "GLM-5",
    family: "bigmodel",
    version: "5",
    detail: "General purpose model, 200K context",
    maxInputTokens: 200000,
    maxOutputTokens: 131072,
    capabilities: {
      toolCalling: true,
      imageInput: false,
      thinking: true,
    },
    requiresThinkingParam: true,
  },
];

export const BIGMODEL_PROVIDER_ID = "bigmodel";

export const BIGMODEL_DEFAULT_BASE_URL = "https://open.bigmodel.cn/api/paas/v4";

// ── Provider Registration ─────────────────────────────
const { register, factory: bigmodelFactory } = createGenericProviderFactory({
  providerId: BIGMODEL_PROVIDER_ID,
  providerName: "BigModel",
  defaultBaseUrl: BIGMODEL_DEFAULT_BASE_URL,
  models: BIGMODEL_MODELS,
  apiKeyPrompt: "Enter your BigModel API Key",
  apiKeyPlaceholder: "your-api-key-here",
  configSection: CONFIG_SECTION,
  createClient: function (baseUrl, apiKey, options?: ClientOptions) {
    return createApiClient({
      baseUrl,
      apiKey,
      providerName: "BigModel",
      timeoutMs: options?.timeoutMs ?? 60_000,
      maxRetries: options?.maxRetries ?? 1,
    });
  },
  convertThinkingParams: (request: ApiRequest, effort: ThinkingEffort) => {
    request.thinking = {
      type: effort === "none" ? "disabled" : "enabled",
    };
  },
});

export function registerBigModelProviderFactory(): IProviderFactory {
  register();
  return bigmodelFactory;
}
