import type { ProviderPreset, TokenPlanModel } from "../core/token-plan";
import models from "./qwen.models.json";

export const qwenPreset: ProviderPreset = {
  id: "qwen",
  defaultBaseUrl:
    "https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1",
  models: models satisfies TokenPlanModel[],
};
