/**
 * 提供者模块导出
 */

export * from './deepseek';
export * from './bigmodel';
export * from './qwen';

import { registerDeepSeekProviderFactory } from './deepseek';
import { registerBigModelProviderFactory } from './bigmodel';
import { registerQwenProviderFactory } from './qwen';

/**
 * 注册所有内置提供者
 */
export function registerAllProviders(): void {
	registerDeepSeekProviderFactory();
	registerBigModelProviderFactory();
	registerQwenProviderFactory();
}
