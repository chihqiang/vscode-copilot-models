import type { ModelDefinition } from "../core/models";
import models from "./deepseek.models.json";

export const deepseekConfig = {
  id: "deepseek",
  name: "DeepSeek",
  defaultBaseUrl: "https://api.deepseek.com",
  apiKeyPrompt: "Enter your DeepSeek API Key",
  apiKeyPlaceholder: "sk-xxxxxxxxxxxxxxxxxxxxxxxx",
  supportsThinking: true,
  thinkingFormat: "thinking_type",
  models: models satisfies ModelDefinition[],
};
