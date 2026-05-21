/**
 * DeepSeek 模型提供者模块
 */
import { ApiRequest, ClientOptions, CONFIG_SECTION, createApiClient, createGenericProviderFactory, IProviderFactory, ModelDefinition, ThinkingEffort } from "../../core";

// ── 模型定义 ──────────────────────────────────────────

export const DEEPSEEK_MODELS: ModelDefinition[] = [
  {
    id: "deepseek-v4-flash",
    name: "DeepSeek V4 Flash",
    family: "deepseek",
    version: "v4",
    detail: "Fast, general-purpose model",
    maxInputTokens: 655360,
    maxOutputTokens: 393216,
    capabilities: {
      toolCalling: true,
      imageInput: true,
      thinking: true,
    },
    requiresThinkingParam: true,
  },
  {
    id: "deepseek-v4-pro",
    name: "DeepSeek V4 Pro",
    family: "deepseek",
    version: "v4",
    detail: "Most capable reasoning model",
    maxInputTokens: 655360,
    maxOutputTokens: 393216,
    capabilities: {
      toolCalling: true,
      imageInput: true,
      thinking: true,
    },
    requiresThinkingParam: true,
  },
];

export const DEEPSEEK_PROVIDER_ID = "deepseek";

export const DEEPSEEK_DEFAULT_BASE_URL = "https://api.deepseek.com";

// ── Provider 注册 ─────────────────────────────────────
const { register, factory: deepseekFactory } = createGenericProviderFactory({
  providerId: DEEPSEEK_PROVIDER_ID,
  providerName: "DeepSeek",
  defaultBaseUrl: DEEPSEEK_DEFAULT_BASE_URL,
  models: DEEPSEEK_MODELS,
  apiKeyPrompt: "Enter your DeepSeek API Key",
  apiKeyPlaceholder: "sk-xxxxxxxxxxxxxxxxxxxxxxxx",
  configSection: CONFIG_SECTION,
  createClient: function (
    baseUrl: string,
    apiKey: string,
    options?: ClientOptions,
  ) {
    return createApiClient({
      baseUrl,
      apiKey,
      providerName: "DeepSeek",
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

export function registerDeepSeekProviderFactory(): IProviderFactory {
  register();
  return deepseekFactory;
}
