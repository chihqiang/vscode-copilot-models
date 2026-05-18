/**
 * 通用 Provider 工厂函数 - 消除重复代码
 */

import vscode from 'vscode';
import type { ApiRequest, ModelDefinition } from '../../core/interfaces';
import { createProviderLogger } from '../../core/logger';
import { ModelRegistry } from '../../core/registry';
import { ProviderFactoryRegistry, createProviderFactory } from '../../core/provider-registry';
import { BaseChatProvider, type ThinkingEffort } from './chat-provider';
import { BaseModelProvider, type ModelProviderConfig } from './model-provider';

// 重新导出 ThinkingEffort 类型
export type { ThinkingEffort } from './chat-provider';

/**
 * 通用 Provider 配置选项
 */
export interface GenericProviderOptions {
	/** 提供商 ID */
	providerId: string;
	/** 提供商显示名称 */
	providerName: string;
	/** 默认基础 URL */
	defaultBaseUrl: string;
	/** 模型列表 */
	models: ModelDefinition[];
	/** API 密钥提示文案 */
	apiKeyPrompt: string;
	/** API 密钥 placeholder */
	apiKeyPlaceholder: string;
	/** 配置节名称 */
	configSection?: string;
	/** 创建 API 客户端函数 */
	createClient: (baseUrl: string, apiKey: string) => unknown;
	/** 转换思考参数函数（可选） */
	convertThinkingParams?: (request: ApiRequest, effort: ThinkingEffort) => void;
}

/**
 * 通用 Provider 工厂结果
 */
export interface GenericProviderFactoryResult {
	/** Provider 工厂 */
	factory: ReturnType<typeof createProviderFactory>;
	/** 注册函数 */
	register: () => void;
	/** Chat Provider 类 */
	GenericChatProvider: new (context: vscode.ExtensionContext) => BaseChatProvider;
	/** Model Provider 类 */
	GenericModelProvider: new (context: vscode.ExtensionContext) => BaseModelProvider;
}

/**
 * 创建通用 Provider 工厂
 * 
 * @param options Provider 配置选项
 * @returns 包含工厂、注册函数和 Provider 类的结果对象
 * 
 * @example
 * // DeepSeek Provider
 * const { register } = createGenericProviderFactory({
 *   providerId: 'deepseek',
 *   providerName: 'DeepSeek',
 *   defaultBaseUrl: 'https://api.deepseek.com',
 *   models: DEEPSEEK_MODELS,
 *   apiKeyPrompt: 'Enter your DeepSeek API Key',
 *   apiKeyPlaceholder: 'sk-xxxxxxxxxxxxxxxxxxxxxxxx',
 *   createClient: createDeepSeekClient,
 *   convertThinkingParams: (request, effort) => {
 *     if (effort !== 'none') {
 *       request.reasoning_effort = effort;
 *     }
 *   },
 * });
 * 
 * export function registerDeepSeekProviderFactory(): void {
 *   register();
 * }
 */
export function createGenericProviderFactory(options: GenericProviderOptions): GenericProviderFactoryResult {
	const configSection = options.configSection || 'copilot-models';
	const logger = createProviderLogger(options.providerId, options.providerName);

	const modelProviderConfig: ModelProviderConfig = {
		providerId: options.providerId,
		providerName: options.providerName,
		configSection,
		defaultBaseUrl: options.defaultBaseUrl,
		models: options.models,
		apiKeyPrompt: options.apiKeyPrompt,
		apiKeyPlaceholder: options.apiKeyPlaceholder,
		createClient: options.createClient as ModelProviderConfig['createClient'],
	};

	/**
	 * 通用 Model Provider 实现
	 */
	class GenericModelProvider extends BaseModelProvider {
		constructor(context: vscode.ExtensionContext) {
			super(context, modelProviderConfig);
			logger.debug(`${options.providerName}ModelProvider created`);
		}
	}

	/**
	 * 通用 Chat Provider 实现
	 */
	class GenericChatProvider extends BaseChatProvider {
		readonly modelProvider: GenericModelProvider;

		constructor(context: vscode.ExtensionContext) {
			const mp = new GenericModelProvider(context);
			super(context, mp);
			this.modelProvider = mp;
			logger.info(`${options.providerName}ChatProvider created`);
		}

		/**
		 * 转换思考参数（支持自定义实现）
		 */
		protected override convertThinkingParams(request: ApiRequest, effort: ThinkingEffort): void {
			if (options.convertThinkingParams) {
				options.convertThinkingParams(request, effort);
			} else {
				// 默认实现：使用 reasoning_effort 参数
				if (effort !== 'none') {
					(request as ApiRequest & { reasoning_effort?: string }).reasoning_effort = effort;
				}
			}
		}
	}

	/**
	 * 创建 Provider 工厂
	 */
	const factory = createProviderFactory({
		providerId: options.providerId,
		providerName: options.providerName,
		configSection,
		createChatProvider: (context) => {
			const chatProvider = new GenericChatProvider(context);
			// GenericModelProvider extends BaseModelProvider which implements IModelProvider
			ModelRegistry.getInstance().registerProvider(chatProvider.modelProvider);
			return chatProvider;
		},
	});

	return {
		factory,
		register: () => ProviderFactoryRegistry.getInstance().register(factory),
		GenericChatProvider,
		GenericModelProvider,
	};
}
