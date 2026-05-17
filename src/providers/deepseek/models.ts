/**
 * DeepSeek 模型定义
 */

import type { ModelDefinition } from '../../core/interfaces';

/**
 * DeepSeek 模型列表
 */
export const DEEPSEEK_MODELS: ModelDefinition[] = [
	{
		id: 'deepseek-v4-flash',
		name: 'DeepSeek V4 Flash',
		family: 'deepseek',
		version: 'v4',
		detail: 'Fast, general-purpose model',
		maxInputTokens: 655360,
		maxOutputTokens: 393216,
		capabilities: {
			toolCalling: true,
			imageInput: true,
			thinking: true,
		},
		requiresThinkingParam: true,
	},
	{
		id: 'deepseek-v4-pro',
		name: 'DeepSeek V4 Pro',
		family: 'deepseek',
		version: 'v4',
		detail: 'Most capable reasoning model',
		maxInputTokens: 655360,
		maxOutputTokens: 393216,
		capabilities: {
			toolCalling: true,
			imageInput: true,
			thinking: true,
		},
		requiresThinkingParam: true,
	},
];

/**
 * DeepSeek 提供商 ID
 */
export const DEEPSEEK_PROVIDER_ID = 'deepseek';

/**
 * DeepSeek API 基础 URL
 */
export const DEEPSEEK_DEFAULT_BASE_URL = 'https://api.deepseek.com';
