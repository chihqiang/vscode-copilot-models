import type { ModelDefinition } from "../core/models";
import models from "./qwen.models.json";

export const qwenConfig = {
  id: "qwen",
  name: "Qwen",
  defaultBaseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
  apiKeyPrompt: "Enter your Qwen API Key",
  apiKeyPlaceholder: "Qwen API Key",
  supportsThinking: true,
  models: models satisfies ModelDefinition[],
};
