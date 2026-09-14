import type { ModelDefinition } from "../core/models";
import models from "./deepseek.models.json";

export const deepseekConfig = {
  id: "deepseek",
  name: "DeepSeek",
  defaultBaseUrl: "https://api.deepseek.com",
  apiKeyPrompt: "Enter your DeepSeek API Key",
  apiKeyPlaceholder: "sk-xxxxxxxxxxxxxxxxxxxxxxxx",
  supportsThinking: true,
  /**
   * `as const` keeps the literal type: without it the property widens to
   * `string`, which no longer satisfies `ThinkingFormat`. The same annotation
   * is on the BigModel config.
   */
  thinkingFormat: "thinking_type" as const,
  models: models satisfies ModelDefinition[],
};
