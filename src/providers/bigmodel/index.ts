/**
 * BigModel (智谱 AI) 模型提供者模块
 */

import type { ModelDefinition, IApiClient, ApiRequest } from '../../core/interfaces';
import { createApiClient } from '../base/client';
import { createGenericProviderFactory, type ThinkingEffort } from '../base/provider-factory';
import { CONFIG_SECTION } from '../../core/consts';

// ── 模型定义 ──────────────────────────────────────────

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

export const BIGMODEL_PROVIDER_ID = 'bigmodel';

export const BIGMODEL_DEFAULT_BASE_URL = 'https://open.bigmodel.cn/api/paas/v4';

// ── API 客户端 ────────────────────────────────────────

export function createBigModelClient(
	baseUrl: string,
	apiKey: string,
	options?: { timeoutMs?: number; maxRetries?: number },
): IApiClient {
	return createApiClient({ baseUrl, apiKey, providerName: 'BigModel', ...options });
}

// ── Provider 注册 ─────────────────────────────────────

const { register, GenericChatProvider } = createGenericProviderFactory({
	providerId: BIGMODEL_PROVIDER_ID,
	providerName: 'BigModel',
	defaultBaseUrl: BIGMODEL_DEFAULT_BASE_URL,
	models: BIGMODEL_MODELS,
	apiKeyPrompt: 'Enter your BigModel API Key',
	apiKeyPlaceholder: 'your-api-key-here',
	configSection: CONFIG_SECTION,
	createClient: createBigModelClient,
	convertThinkingParams: (request: ApiRequest, effort: ThinkingEffort) => {
		request.thinking = {
			type: effort === 'none' ? 'disabled' : 'enabled',
		};
	},
});

export class BigModelChatProvider extends GenericChatProvider {}

export function registerBigModelProviderFactory(): void {
	register();
}
