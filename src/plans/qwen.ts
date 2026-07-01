import type { ProviderPreset } from "../core/token-plan";

export const qwenPreset: ProviderPreset = {
  id: "qwen",
  defaultBaseUrl: "https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1",
  models: [
    { id: "qwen3.7-max" },
    { id: "qwen3.7-plus" },
    { id: "qwen3.6-flash" },
    { id: "qwen3.6-plus" },
    { id: "glm-5.2" },
    { id: "glm-5.1" },
    { id: "glm-5" },
    { id: "deepseek-v4-pro" },
    { id: "deepseek-v4-flash" },
  ],
};
