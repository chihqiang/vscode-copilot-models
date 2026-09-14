import type { ModelDefinition } from "../core/models";
import models from "./qwen.models.json";

export const qwenConfig = {
  id: "qwen",
  name: "Qwen",
  defaultBaseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
  apiKeyPrompt: "Enter your Qwen API Key",
  apiKeyPlaceholder: "Qwen API Key",
  supportsThinking: true,
  /**
   * DashScope's own toggle. Thinking is on by default for these models, and
   * `enable_thinking: false` is the documented way to turn it off — the
   * `reasoning_effort` this provider used to send alone left it on.
   */
  thinkingFormat: "enable_thinking" as const,
  models: models satisfies ModelDefinition[],
};
