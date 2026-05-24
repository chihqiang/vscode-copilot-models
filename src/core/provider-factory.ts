/**
 * Generic Provider factory function - eliminates boilerplate code
 */

import vscode from 'vscode';
import {  CONFIG_SECTION, type ModelDefinition } from './models';
import { createProviderLogger } from './logger';
import { ModelRegistry } from './model-registry';
import { ProviderFactoryRegistry, createProviderFactory } from './provider-registry';
import { BaseChatProvider, type ThinkingEffort } from './chat-provider';
import { BaseModelProvider, type ModelProviderConfig } from './model-provider';
import { ApiRequest, ClientOptions, IApiClient } from './client';

// Re-export ThinkingEffort type
export type { ThinkingEffort } from './chat-provider';

/**
 * Generic Provider configuration options
 */
export interface GenericProviderOptions<TClient extends IApiClient = IApiClient> {
	/** Provider ID */
	providerId: string;
	/** Provider display name */
	providerName: string;
	/** Default base URL */
	defaultBaseUrl: string;
	/** Model list */
	models: ModelDefinition[];
	/** API key prompt text */
	apiKeyPrompt: string;
	/** API key placeholder */
	apiKeyPlaceholder: string;
	/** Configuration section name */
	configSection?: string;
	/** Create API client function */
	createClient: (baseUrl: string, apiKey: string, options?: ClientOptions) => TClient;
	/** Convert thinking params function (optional) */
	convertThinkingParams?: (request: ApiRequest, effort: ThinkingEffort) => void;
}

/**
 * Generic Provider factory result
 */
export interface GenericProviderFactoryResult {
	/** Provider factory */
	factory: ReturnType<typeof createProviderFactory>;
	/** Register function */
	register: () => void;
	/** Chat Provider class */
	GenericChatProvider: new (context: vscode.ExtensionContext) => BaseChatProvider;
	/** Model Provider class */
	GenericModelProvider: new (context: vscode.ExtensionContext) => BaseModelProvider;
}

/**
 * Create generic Provider factory
 * 
 * @param options Provider configuration options
 * @returns Result object containing factory, register function and Provider classes
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
	const configSection = options.configSection || CONFIG_SECTION;
	const logger = createProviderLogger(options.providerId, options.providerName);

	const modelProviderConfig: ModelProviderConfig = {
		providerId: options.providerId,
		providerName: options.providerName,
		configSection,
		defaultBaseUrl: options.defaultBaseUrl,
		models: options.models,
		apiKeyPrompt: options.apiKeyPrompt,
		apiKeyPlaceholder: options.apiKeyPlaceholder,
		createClient: options.createClient,
	};

	/**
	 * Generic Model Provider implementation
	 */
	class GenericModelProvider extends BaseModelProvider {
		constructor(context: vscode.ExtensionContext) {
			super(context, modelProviderConfig);
			logger.debug(`${options.providerName}ModelProvider created`);
		}
	}

	/**
	 * Generic Chat Provider implementation
	 */
	class GenericChatProvider extends BaseChatProvider {
		readonly modelProvider: GenericModelProvider;

		constructor(context: vscode.ExtensionContext) {
			const mp = new GenericModelProvider(context);
			super(context, mp);
			this.modelProvider = mp;
			logger.debug(`${options.providerName}ChatProvider created`);
		}

		/**
		 * Convert thinking params (supports custom implementation)
		 */
		protected override convertThinkingParams(request: ApiRequest, effort: ThinkingEffort): void {
			if (options.convertThinkingParams) {
				options.convertThinkingParams(request, effort);
			} else {
				// Default implementation: use reasoning_effort parameter
				if (effort !== 'none') {
					request.reasoning_effort = effort;
				}
			}
		}
	}

	/**
	 * Create Provider factory
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
