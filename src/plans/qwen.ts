import type { ProviderPreset } from "../core/token-plan";

export const qwenPreset: ProviderPreset = {
  id: "qwen",
  defaultBaseUrl:
    "https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1",
  models: [
    { id: "qwen3.8-max" },
    { id: "qwen3.8-flash" },
    { id: "qwen3.7-plus" },
    { id: "qwen3.7-flash" },
    { id: "glm-5.2" },
    { id: "deepseek-v4-pro" },
    { id: "deepseek-v4-flash" },
  ],
};
