/**
 * DeepSeek 模型提供者模块
 */

import type { ModelDefinition, IApiClient, ApiRequest } from '../../core/interfaces';
import { createApiClient } from '../base/client';
import { createGenericProviderFactory, type ThinkingEffort } from '../base/provider-factory';
import { CONFIG_SECTION } from '../../core/consts';

// ── 模型定义 ──────────────────────────────────────────

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

export const DEEPSEEK_PROVIDER_ID = 'deepseek';

export const DEEPSEEK_DEFAULT_BASE_URL = 'https://api.deepseek.com';

// ── API 客户端 ────────────────────────────────────────

export function createDeepSeekClient(
	baseUrl: string,
	apiKey: string,
	options?: { timeoutMs?: number; maxRetries?: number },
): IApiClient {
	return createApiClient({
		baseUrl,
		apiKey,
		providerName: 'DeepSeek',
		timeoutMs: options?.timeoutMs ?? 60_000,
		maxRetries: options?.maxRetries ?? 1,
	});
}

// ── Provider 注册 ─────────────────────────────────────

const { register, GenericChatProvider } = createGenericProviderFactory({
	providerId: DEEPSEEK_PROVIDER_ID,
	providerName: 'DeepSeek',
	defaultBaseUrl: DEEPSEEK_DEFAULT_BASE_URL,
	models: DEEPSEEK_MODELS,
	apiKeyPrompt: 'Enter your DeepSeek API Key',
	apiKeyPlaceholder: 'sk-xxxxxxxxxxxxxxxxxxxxxxxx',
	configSection: CONFIG_SECTION,
	createClient: createDeepSeekClient,
	convertThinkingParams: (request: ApiRequest, effort: ThinkingEffort) => {
		if (effort !== 'none') {
			request.reasoning_effort = effort;
		}
	},
});

export class DeepSeekChatProvider extends GenericChatProvider {}

export function registerDeepSeekProviderFactory(): void {
	register();
}
