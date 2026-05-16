/**
 * 提供者模块导出
 */

export * from './base';
export * from './deepseek';

/**
 * 注册所有内置提供者
 */
export function registerAllProviders(): void {
	// 注册 DeepSeek 提供者工厂
	const { registerDeepSeekProviderFactory } = require('./deepseek');
	registerDeepSeekProviderFactory();
}
