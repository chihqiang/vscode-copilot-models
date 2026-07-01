/**
 * Built-in provider plan presets (pure data)
 *
 * 每个服务商一个文件，只定义数据对象。
 * 所有逻辑（URL 匹配、CRUD、消费记录等）在 src/core/token-plan.ts 的 TokenPlan 类中。
 */

import { qwenPreset } from "./qwen";

export const builtInPresets = [
  qwenPreset,
];
