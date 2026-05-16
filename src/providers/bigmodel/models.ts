/**
 * BigModel (智谱AI) 模型定义
 */

import type { ModelDefinition } from '../../core/interfaces';

/**
 * BigModel 模型列表
 */
export const BIGMODEL_MODELS: ModelDefinition[] = [
	{
		id: 'glm-5.1',
		name: 'GLM-5.1',
		family: 'bigmodel',
		version: '5.1',
		detail: 'Flagship base model, 200K context, thinking enabled',
		maxInputTokens: 200000,
		maxOutputTokens: 131072,
		capabilities: {
			toolCalling: true,
			imageInput: false,
			thinking: true,
		},
		requiresThinkingParam: true,
	},
	{
		id: 'glm-5-turbo',
		name: 'GLM-5-Turbo',
		family: 'bigmodel',
		version: '5',
		detail: 'Optimized for OpenClaw scenarios, 200K context',
		maxInputTokens: 200000,
		maxOutputTokens: 131072,
		capabilities: {
			toolCalling: true,
			imageInput: false,
			thinking: true,
		},
		requiresThinkingParam: true,
	},
	{
		id: 'glm-5',
		name: 'GLM-5',
		family: 'bigmodel',
		version: '5',
		detail: 'General purpose model, 200K context',
		maxInputTokens: 200000,
		maxOutputTokens: 131072,
		capabilities: {
			toolCalling: true,
			imageInput: false,
			thinking: true,
		},
		requiresThinkingParam: true,
	},
];

/**
 * BigModel 配置节
 */
export const BIGMODEL_CONFIG_SECTION = 'copilot-models';

/**
 * BigModel 提供商 ID
 */
export const BIGMODEL_PROVIDER_ID = 'bigmodel';

/**
 * BigModel API 基础 URL
 */
export const BIGMODEL_DEFAULT_BASE_URL = 'https://open.bigmodel.cn/api/paas/v4';
