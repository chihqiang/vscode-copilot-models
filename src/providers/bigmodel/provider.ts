/**
 * BigModel (智谱AI) 模型提供者
 */

import vscode from 'vscode';
import type { ApiRequest, IApiClient, IModelProvider } from '../../core/interfaces';
import { createProviderLogger } from '../../core/logger';
import { ModelRegistry } from '../../core/registry';
import { ProviderFactoryRegistry, createProviderFactory } from '../../core/provider-registry';
import {
	BaseChatProvider,
	type ThinkingEffort,
} from '../base/chat-provider';
import { BaseModelProvider, type ModelProviderConfig } from '../base/model-provider';
import { createBigModelClient } from './client';
import { BIGMODEL_DEFAULT_BASE_URL, BIGMODEL_MODELS, BIGMODEL_PROVIDER_ID } from './models';
import { CONFIG_SECTION } from '../../core/consts';

/** BigModel 日志记录器 */
const logger = createProviderLogger(BIGMODEL_PROVIDER_ID, 'BigModel');

/**
 * BigModel ModelProvider 配置
 */
const bigmodelModelProviderConfig: ModelProviderConfig = {
	providerId: BIGMODEL_PROVIDER_ID,
	providerName: 'BigModel',
	configSection: CONFIG_SECTION,
	defaultBaseUrl: BIGMODEL_DEFAULT_BASE_URL,
	models: BIGMODEL_MODELS,
	apiKeyPrompt: 'Enter your BigModel API Key',
	apiKeyPlaceholder: 'your-api-key-here',
	createClient: (baseUrl: string, apiKey: string) => createBigModelClient(baseUrl, apiKey),
};

/**
 * BigModel ModelProvider 实现
 */
class BigModelModelProvider extends BaseModelProvider {
	constructor(context: vscode.ExtensionContext) {
		super(context, bigmodelModelProviderConfig);
		logger.debug('BigModelModelProvider created');
	}
}

/**
 * BigModel Chat Provider 实现
 */
export class BigModelChatProvider extends BaseChatProvider {
	readonly modelProvider: BigModelModelProvider;

	constructor(context: vscode.ExtensionContext) {
		const mp = new BigModelModelProvider(context);
		super(context, mp);
		this.modelProvider = mp;
		logger.info('BigModelChatProvider created');
	}

	/**
	 * 转换思考参数为 BigModel API 格式
	 */
	protected override convertThinkingParams(request: ApiRequest, effort: ThinkingEffort): void {
		(request as ApiRequest & { thinking?: { type: 'enabled' | 'disabled' } }).thinking = {
			type: effort === 'none' ? 'disabled' : 'enabled',
		};
	}
}

/**
 * BigModel 提供者工厂
 */
const bigmodelProviderFactory = createProviderFactory({
	providerId: BIGMODEL_PROVIDER_ID,
	providerName: 'BigModel',
	configSection: CONFIG_SECTION,
	createChatProvider: (context) => {
		const chatProvider = new BigModelChatProvider(context);
		ModelRegistry.getInstance().registerProvider(chatProvider.modelProvider as unknown as IModelProvider);
		return chatProvider;
	},
});

/**
 * 初始化 BigModel 提供者注册
 */
export function registerBigModelProviderFactory(): void {
	ProviderFactoryRegistry.getInstance().register(bigmodelProviderFactory);
}
