/**
 * BigModel (智谱 AI) 模型提供者
 */

import type { ApiRequest } from '../../core/interfaces';
import { createBigModelClient } from './client';
import { BIGMODEL_DEFAULT_BASE_URL, BIGMODEL_MODELS, BIGMODEL_PROVIDER_ID } from './models';
import { CONFIG_SECTION } from '../../core/consts';
import { createGenericProviderFactory, type ThinkingEffort } from '../base/provider-factory';

/**
 * BigModel 提供者工厂
 */
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
		(request as ApiRequest & { thinking?: { type: 'enabled' | 'disabled' } }).thinking = {
			type: effort === 'none' ? 'disabled' : 'enabled',
		};
	},
});

/**
 * BigModel Chat Provider（导出用于类型检查）
 */
export class BigModelChatProvider extends GenericChatProvider {}

/**
 * 初始化 BigModel 提供者注册
 */
export function registerBigModelProviderFactory(): void {
	register();
}
