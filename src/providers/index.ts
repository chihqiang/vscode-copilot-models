/**
 * 提供者模块导出
 */

export * from './deepseek';
export * from './bigmodel';

import { registerDeepSeekProviderFactory } from './deepseek';
import { registerBigModelProviderFactory } from './bigmodel';

/**
 * 注册所有内置提供者
 */
export function registerAllProviders(): void {
	registerDeepSeekProviderFactory();
	registerBigModelProviderFactory();
}
