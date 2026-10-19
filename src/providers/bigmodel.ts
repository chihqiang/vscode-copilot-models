import type { ModelDefinition } from "../core/models";
import models from "./bigmodel.models.json";

export const bigmodelConfig = {
  id: "bigmodel",
  name: "BigModel",
  defaultBaseUrl: "https://open.bigmodel.cn/api/paas/v4",
  apiKeyPrompt: "Enter your BigModel API Key",
  apiKeyPlaceholder: "your-api-key-here",
  supportsThinking: true,
  /** BigModel 使用 thinking: { type: "disabled" | "enabled" } 格式 */
  thinkingFormat: "thinking_type" as const,
  /** BigModel 的 tool_choice 仅支持 "auto" */
  supportsRequiredToolChoice: false,
  models: models satisfies ModelDefinition[],
};
