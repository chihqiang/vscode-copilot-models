/**
 * 扩展共享的编译时常量
 */

import type { ModelDefinition } from './interfaces';

/** VS Code 配置节前缀 */
export const CONFIG_SECTION = 'copilot-models';

/** 语言模型聊天系统角色 (VS Code 内部值) */
export const LANGUAGE_MODEL_CHAT_SYSTEM_ROLE = 3;

/** SecretStorage 中 API 密钥的键名前缀 */
export const API_KEY_SECRET_PREFIX = 'copilot-models';

/** 注册的模型定义 */
export interface RegisteredModels {
	[key: string]: ModelDefinition[];
}
