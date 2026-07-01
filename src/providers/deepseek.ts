import type { ModelDefinition } from "../core/models";

export const deepseekConfig = {
  id: "deepseek",
  name: "DeepSeek",
  defaultBaseUrl: "https://api.deepseek.com",
  apiKeyPrompt: "Enter your DeepSeek API Key",
  apiKeyPlaceholder: "sk-xxxxxxxxxxxxxxxxxxxxxxxx",
  supportsThinking: true,
  models: [
    {
      id: "deepseek-v4-flash",
      name: "DeepSeek V4 Flash",
      family: "deepseek",
      version: "v4",
      detail: "Fast, general-purpose model",
      maxInputTokens: 655360,
      maxOutputTokens: 393216,
      capabilities: { toolCalling: true, imageInput: true, thinking: true },
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
      capabilities: { toolCalling: true, imageInput: true, thinking: true },
      requiresThinkingParam: true,
    },
  ] satisfies ModelDefinition[],
};
