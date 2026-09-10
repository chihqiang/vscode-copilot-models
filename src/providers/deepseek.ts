import type { ModelDefinition } from "../core/models";

export const deepseekConfig = {
  id: "deepseek",
  name: "DeepSeek",
  defaultBaseUrl: "https://api.deepseek.com",
  apiKeyPrompt: "Enter your DeepSeek API Key",
  apiKeyPlaceholder: "sk-xxxxxxxxxxxxxxxxxxxxxxxx",
  supportsThinking: true,
  thinkingFormat: "thinking_type",
  models: [
    {
      id: "deepseek-flash",
      name: "DeepSeek V4.1 Flash",
      family: "deepseek",
      version: "v4.1",
      detail: "Fast general-purpose model with 1M context and vision support",
      maxInputTokens: 1000000,
      maxOutputTokens: 393216,
      capabilities: { toolCalling: true, imageInput: true, thinking: true },
      requiresThinkingParam: true,
    },
  ] satisfies ModelDefinition[],
};
