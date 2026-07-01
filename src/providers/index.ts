/**
 * Built-in provider configs (pure data)
 *
 * 每个服务商一个文件，只定义数据对象。
 * 所有注册和运行时逻辑在 src/core/provider-models.ts 的 ProviderModels 类中。
 */

import { deepseekConfig } from "./deepseek";
import { bigmodelConfig } from "./bigmodel";
import { qwenConfig } from "./qwen";

export { deepseekConfig } from "./deepseek";
export { bigmodelConfig } from "./bigmodel";
export { qwenConfig } from "./qwen";

export const builtInProviders = [deepseekConfig, bigmodelConfig, qwenConfig];
