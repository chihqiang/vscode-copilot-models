/**
 * DeepSeek 模型提供者
 */

import type { ApiRequest } from '../../core/interfaces';
import { createDeepSeekClient } from './client';
import { DEEPSEEK_DEFAULT_BASE_URL, DEEPSEEK_MODELS, DEEPSEEK_PROVIDER_ID } from './models';
import { CONFIG_SECTION } from '../../core/consts';
import { createGenericProviderFactory, type ThinkingEffort } from '../base/provider-factory';

/**
 * DeepSeek 提供者工厂
 */
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
			(request as ApiRequest & { reasoning_effort?: string }).reasoning_effort = effort;
		}
	},
});

/**
 * DeepSeek Chat Provider（导出用于类型检查）
 */
export class DeepSeekChatProvider extends GenericChatProvider {}

/**
 * 初始化 DeepSeek 提供者注册
 */
export function registerDeepSeekProviderFactory(): void {
	register();
}
