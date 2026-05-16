/**
 * DeepSeek 模型提供者
 */

import vscode from 'vscode';
import type { ApiRequest, IApiClient, IModelProvider, ModelDefinition } from '../../core/interfaces';
import { createProviderLogger } from '../../core/logger';
import { ModelRegistry } from '../../core/registry';
import { ProviderFactoryRegistry, createProviderFactory } from '../../core/provider-registry';
import {
	BaseChatProvider,
	type ThinkingEffort,
} from '../base/chat-provider';
import { BaseModelProvider, type ModelProviderConfig } from '../base/model-provider';
import { createDeepSeekClient } from './client';
import {
	DEEPSEEK_CONFIG_SECTION,
	DEEPSEEK_DEFAULT_BASE_URL,
	DEEPSEEK_MODELS,
	DEEPSEEK_PROVIDER_ID,
} from './models';

/** DeepSeek 日志记录器 */
const logger = createProviderLogger(DEEPSEEK_PROVIDER_ID, 'DeepSeek');

/**
 * DeepSeek ModelProvider 配置
 */
const deepseekModelProviderConfig: ModelProviderConfig = {
	providerId: DEEPSEEK_PROVIDER_ID,
	providerName: 'DeepSeek',
	configSection: DEEPSEEK_CONFIG_SECTION,
	defaultBaseUrl: DEEPSEEK_DEFAULT_BASE_URL,
	models: DEEPSEEK_MODELS,
	apiKeyPrompt: 'Enter your DeepSeek API Key',
	apiKeyPlaceholder: 'sk-xxxxxxxxxxxxxxxxxxxxxxxx',
	createClient: (baseUrl: string, apiKey: string) => createDeepSeekClient(baseUrl, apiKey),
};

/**
 * DeepSeek ModelProvider 实现
 */
class DeepSeekModelProvider extends BaseModelProvider {
	constructor(context: vscode.ExtensionContext) {
		super(context, deepseekModelProviderConfig);
		logger.debug('DeepSeekModelProvider created');
	}
}

/**
 * DeepSeek Chat Provider 实现
 */
export class DeepSeekChatProvider extends BaseChatProvider {
	readonly modelProvider: DeepSeekModelProvider;

	constructor(context: vscode.ExtensionContext) {
		const mp = new DeepSeekModelProvider(context);
		super(context, mp);
		this.modelProvider = mp;
		logger.info('DeepSeekChatProvider created');
	}

	/**
	 * 转换思考参数为 DeepSeek API 格式
	 */
	protected override convertThinkingParams(request: ApiRequest, effort: ThinkingEffort): void {
		if (effort !== 'none') {
			(request as ApiRequest & { reasoning_effort?: string }).reasoning_effort = effort;
		}
	}
}

/**
 * DeepSeek 提供者工厂
 */
const deepseekProviderFactory = createProviderFactory({
	providerId: DEEPSEEK_PROVIDER_ID,
	providerName: 'DeepSeek',
	configSection: DEEPSEEK_CONFIG_SECTION,
	createChatProvider: (context) => {
		const chatProvider = new DeepSeekChatProvider(context);
		ModelRegistry.getInstance().registerProvider(chatProvider.modelProvider as unknown as IModelProvider);
		return chatProvider;
	},
});

/**
 * 初始化 DeepSeek 提供者注册
 */
export function registerDeepSeekProviderFactory(): void {
	ProviderFactoryRegistry.getInstance().register(deepseekProviderFactory);
}
