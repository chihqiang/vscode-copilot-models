/**
 * BigModel (智谱AI) 模型提供者
 */

import vscode from 'vscode';
import type {
	ApiMessage,
	ApiRequest,
	IModelProvider,
	ModelDefinition,
	ProviderConfig,
	StreamCallbacks,
} from '../../core/interfaces';
import { createProviderLogger, logger as globalLogger } from '../../core/logger';
import { ModelRegistry } from '../../core/registry';
import { IProviderFactory, ProviderFactoryRegistry } from '../../core/provider-registry';
import { BaseAuthManager } from '../base/auth-manager';
import { BaseChatProvider, type ModelPickerChatInformation } from '../base/chat-provider';
import { BigModelClient } from './client';
import {
	BIGMODEL_CONFIG_SECTION,
	BIGMODEL_DEFAULT_BASE_URL,
	BIGMODEL_MODELS,
	BIGMODEL_PROVIDER_ID,
} from './models';

/** BigModel 日志记录器 */
const providerLogger = createProviderLogger(BIGMODEL_PROVIDER_ID, 'BigModel');

/** BigModel 日志（同时支持通用日志） */
const logger = {
	...providerLogger,
	chat: globalLogger.chat,
	stream: globalLogger.stream,
};

/**
 * BigModel 认证管理器
 */
class BigModelAuthManager extends BaseAuthManager {
	constructor(context: vscode.ExtensionContext) {
		super(context, BIGMODEL_CONFIG_SECTION, BIGMODEL_PROVIDER_ID);
		logger.debug('BigModelAuthManager created');
	}

	override async promptForApiKey(): Promise<boolean> {
		logger.info('Prompting for BigModel API key...');
		return super.promptForApiKey(
			'Enter your BigModel API Key',
			'your-api-key-here',
		);
	}
}

/**
 * BigModel 模型提供商
 */
export class BigModelModelProvider implements IModelProvider {
	readonly config: ProviderConfig = {
		vendorId: BIGMODEL_PROVIDER_ID,
		vendorName: 'BigModel',
		baseUrl: BIGMODEL_DEFAULT_BASE_URL,
		apiKeyConfigKey: `${BIGMODEL_CONFIG_SECTION}.bigmodelApiKey`,
		apiKeySecretKey: `${BIGMODEL_CONFIG_SECTION}.bigmodel.apiKey`,
		modelIdOverridesConfigKey: `${BIGMODEL_CONFIG_SECTION}.modelIdOverrides`,
	};

	readonly id = BIGMODEL_PROVIDER_ID;
	private readonly authManager: BigModelAuthManager;

	constructor(context: vscode.ExtensionContext) {
		logger.info('Creating BigModelModelProvider...');
		this.authManager = new BigModelAuthManager(context);
	}

	getApiKey(): Promise<string | undefined> {
		return this.authManager.getApiKey();
	}

	hasApiKey(): Promise<boolean> {
		return this.authManager.hasApiKey();
	}

	async promptForApiKey(): Promise<boolean> {
		return this.authManager.promptForApiKey();
	}

	deleteApiKey(): Promise<void> {
		return this.authManager.deleteApiKey();
	}

	getModels(): ModelDefinition[] {
		logger.debug(`Returning ${BIGMODEL_MODELS.length} models`);
		return BIGMODEL_MODELS;
	}

	createClient(apiKey: string): BigModelClient {
		const baseUrl = this.getBaseUrl();
		logger.debug(`Creating BigModelClient, baseUrl: ${baseUrl}`);
		return new BigModelClient(baseUrl, apiKey);
	}

	getBaseUrl(): string {
		const config = vscode.workspace.getConfiguration(BIGMODEL_CONFIG_SECTION);
		const baseUrl = config.get<string>('bigmodelBaseUrl') || BIGMODEL_DEFAULT_BASE_URL;
		logger.debug(`getBaseUrl: ${baseUrl}`);
		return baseUrl;
	}

	getApiModelId(vscodeModelId: string): string {
		const config = vscode.workspace.getConfiguration(BIGMODEL_CONFIG_SECTION);
		const overrides = config.get<Record<string, string>>('modelIdOverrides');
		const modelId = overrides?.[vscodeModelId]?.trim() || vscodeModelId;
		if (overrides?.[vscodeModelId]) {
			logger.debug(`Model ID override: ${vscodeModelId} -> ${modelId}`);
		}
		return modelId;
	}
}

/**
 * BigModel Chat Provider 实现
 */
export class BigModelChatProvider extends BaseChatProvider {
	readonly modelProvider: BigModelModelProvider;

	constructor(context: vscode.ExtensionContext) {
		super(context, new BigModelModelProvider(context));
		this.modelProvider = this.provider as BigModelModelProvider;
		logger.info('BigModelChatProvider created');
	}

	protected override affectsConfiguration(e: vscode.ConfigurationChangeEvent): boolean {
		return (
			e.affectsConfiguration(`${BIGMODEL_CONFIG_SECTION}.bigmodelBaseUrl`) ||
			e.affectsConfiguration(`${BIGMODEL_CONFIG_SECTION}.modelIdOverrides`) ||
			e.affectsConfiguration(`${BIGMODEL_CONFIG_SECTION}.bigmodelApiKey`)
		);
	}

	protected override affectsSecretKey(e: vscode.SecretStorageChangeEvent): boolean {
		return e.key === this.modelProvider.config.apiKeySecretKey;
	}

	protected override toChatInfo(model: ModelDefinition, hasApiKey: boolean): ModelPickerChatInformation {
		logger.debug(`Converting model to chat info: ${model.id}, hasApiKey: ${hasApiKey}`);
		return {
			id: model.id,
			name: model.name,
			family: model.family,
			version: model.version,
			detail: hasApiKey ? model.detail : 'API key required',
			tooltip: hasApiKey ? undefined : 'Please configure API key',
			statusIcon: hasApiKey ? undefined : new vscode.ThemeIcon('warning'),
			maxInputTokens: model.maxInputTokens,
			maxOutputTokens: model.maxOutputTokens,
			isUserSelectable: true,
			capabilities: {
				toolCalling: model.capabilities.toolCalling,
				imageInput: model.capabilities.imageInput,
			},
			...(model.capabilities.thinking ? { configurationSchema: this.buildThinkingSchema() } : {}),
		};
	}

	private buildThinkingSchema() {
		return {
			properties: {
				thinking: {
					type: 'object',
					title: 'Thinking Mode',
					properties: {
						type: {
							type: 'string',
							title: 'Type',
							enum: ['disabled', 'enabled'],
							enumItemLabels: ['Disabled', 'Enabled'],
							enumDescriptions: [
								'Disable thinking mode',
								'Enable deep thinking mode',
							],
							default: 'enabled',
							group: 'navigation',
						},
					},
				},
			},
		};
	}

	protected override getApiModelId(vscodeModelId: string): string {
		return this.modelProvider.getApiModelId(vscodeModelId);
	}

	protected override convertMessages(
		messages: readonly vscode.LanguageModelChatRequestMessage[],
		isThinkingModel: boolean,
	): ApiMessage[] {
		logger.chat.debug(`Converting ${messages.length} messages`);

		// 打印每条原始消息用于调试
		for (let i = 0; i < messages.length; i++) {
			const msg = messages[i];
			const partsInfo = msg.content.map((p) => {
				if (p instanceof vscode.LanguageModelTextPart) {
					return `TextPart(${p.value.substring(0, 50)}...)`;
				}
				if (p instanceof vscode.LanguageModelToolCallPart) {
					return `ToolCallPart(${p.name})`;
				}
				if (p instanceof vscode.LanguageModelToolResultPart) {
					return `ToolResultPart(${p.callId})`;
				}
				return `UnknownPart`;
			});
			logger.chat.debug(`  Message ${i}: role=${msg.role}, parts=[${partsInfo.join(', ')}]`);
		}

		const result: ApiMessage[] = [];

		for (const message of messages) {
			const role = this.mapRole(message.role);
			let content = '';
			let toolCalls: ApiMessage['tool_calls'] = [];
			const toolResults: Array<{ callId: string; content: string }> = [];

			for (const part of message.content) {
				if (part instanceof vscode.LanguageModelTextPart) {
					content += part.value;
				} else if (part instanceof vscode.LanguageModelToolCallPart) {
					toolCalls.push({
						id: part.callId,
						type: 'function',
						function: {
							name: part.name,
							arguments: JSON.stringify(part.input),
						},
					});
				} else if (part instanceof vscode.LanguageModelToolResultPart) {
					let toolContent = '';
					for (const item of part.content) {
						if (item instanceof vscode.LanguageModelTextPart) {
							toolContent += item.value;
						}
					}
					toolResults.push({
						callId: part.callId,
						content: toolContent || JSON.stringify(part.content),
					});
				}
			}

			if (role === 'assistant') {
				if (content || toolCalls.length > 0) {
					const msg: ApiMessage = {
						role: 'assistant',
						content: content || '',
					};

					if (toolCalls.length > 0) {
						msg.tool_calls = toolCalls as NonNullable<ApiMessage['tool_calls']>;
					}

					result.push(msg);
				}
			} else {
				if (content) {
					result.push({
						role: role as 'user' | 'assistant',
						content: content,
					});
				}
			}

			// 添加工具结果消息
			for (const tr of toolResults) {
				result.push({
					role: 'tool',
					content: tr.content,
					tool_call_id: tr.callId,
				});
			}
		}

		logger.chat.debug(`Converted to ${result.length} API messages`);
		return result;
	}

	private mapRole(role: vscode.LanguageModelChatMessageRole): string {
		switch (role) {
			case vscode.LanguageModelChatMessageRole.User:
				return 'user';
			case vscode.LanguageModelChatMessageRole.Assistant:
				return 'assistant';
			default:
				return 'user';
		}
	}

	protected override async sendStreamRequest(
		request: ApiRequest,
		progress: vscode.Progress<vscode.LanguageModelResponsePart>,
		token: vscode.CancellationToken,
	): Promise<void> {
		logger.info(`Sending stream request, model: ${request.model}`);

		const apiKey = await this.modelProvider.getApiKey();
		if (!apiKey) {
			logger.error('BigModel API key not configured');
			throw new Error('BigModel API key not configured');
		}

		const client = this.modelProvider.createClient(apiKey);
		const callbacks = this.createStreamCallbacks(progress);
		await client.streamChatCompletion(request, callbacks, token);
	}

	private createStreamCallbacks(progress: vscode.Progress<vscode.LanguageModelResponsePart>): StreamCallbacks {
		let content = '';
		let thinking = '';
		let toolCalls: { name: string; args: string }[] = [];
		let finalUsage: { prompt_tokens: number; completion_tokens: number; total_tokens: number } | null = null;

		return {
			onContent: (text: string) => {
				content += text;
				progress.report(new vscode.LanguageModelTextPart(text));
			},
			onThinking: (text: string) => {
				thinking += text;
				// 使用 proposed API: LanguageModelThinkingPart
				// @ts-expect-error LanguageModelThinkingPart is a proposed API
				progress.report(new vscode.LanguageModelThinkingPart(text));
			},
			onToolCall: (toolCall) => {
				try {
					const args = JSON.parse(toolCall.function.arguments);
					toolCalls.push({ name: toolCall.function.name, args: JSON.stringify(args) });
					progress.report(
						new vscode.LanguageModelToolCallPart(toolCall.id, toolCall.function.name, args),
					);
				} catch {
					toolCalls.push({ name: toolCall.function.name, args: toolCall.function.arguments });
					progress.report(
						new vscode.LanguageModelToolCallPart(toolCall.id, toolCall.function.name, {}),
					);
				}
			},
			onUsage: (usage) => {
				finalUsage = {
					prompt_tokens: usage.prompt_tokens,
					completion_tokens: usage.completion_tokens,
					total_tokens: usage.total_tokens,
				};
			},
			onError: (error: Error) => {
				logger.error(`Stream error: ${error.message}`);
				throw error;
			},
			onDone: () => {
				// 打印完整响应内容
				if (content) {
					logger.stream.info(`=== Response Content ===\n${content}`);
				}

				// 打印思考内容
				if (thinking) {
					logger.stream.info(`=== Thinking Content ===\n${thinking}`);
				}

				// 打印工具调用
				if (toolCalls.length > 0) {
					logger.stream.info(`=== Tool Calls (${toolCalls.length}) ===`);
					for (const tc of toolCalls) {
						logger.stream.info(`  - ${tc.name}: ${tc.args}`);
					}
				}

				// 打印 Token 使用统计
				if (finalUsage) {
					logger.stream.info(
						`=== Token Usage ===\n` +
							`  prompt_tokens: ${finalUsage.prompt_tokens}\n` +
							`  completion_tokens: ${finalUsage.completion_tokens}\n` +
							`  total_tokens: ${finalUsage.total_tokens}`,
					);
				}
			},
		};
	}

	/**
	 * 配置 API 密钥
	 */
	async configureApiKey(): Promise<void> {
		logger.info('Configuring API key...');
		const saved = await this.modelProvider.promptForApiKey();
		if (saved) {
			logger.info('API key configured successfully');
			this.refreshModelPicker();
		} else {
			logger.info('API key configuration cancelled');
		}
	}

	/**
	 * 清除 API 密钥
	 */
	async clearApiKey(): Promise<void> {
		logger.info('Clearing API key...');
		await this.modelProvider.deleteApiKey();
		this.refreshModelPicker();
		vscode.window.showInformationMessage('BigModel API key cleared');
	}

	/**
	 * 刷新模型列表
	 */
	async refreshModels(): Promise<void> {
		logger.info('Refreshing models...');
		this.refreshModelPicker();
	}
}

/**
 * BigModel 提供者工厂 - 实现 IProviderFactory 接口
 */
export class BigModelProviderFactory implements IProviderFactory {
	readonly providerId = BIGMODEL_PROVIDER_ID;
	readonly providerName = 'BigModel';

	isEnabled(): boolean {
		const config = vscode.workspace.getConfiguration(BIGMODEL_CONFIG_SECTION);
		return config.get<boolean>('enabled', true);
	}

	createChatProvider(context: vscode.ExtensionContext): BigModelChatProvider {
		logger.info('Creating BigModelChatProvider from factory...');
		const chatProvider = new BigModelChatProvider(context);

		// 注册到模型注册表
		ModelRegistry.getInstance().registerProvider(chatProvider.modelProvider);

		logger.info('BigModel provider registered successfully');
		return chatProvider;
	}
}

/**
 * BigModel 提供者工厂单例
 */
export const bigmodelProviderFactory = new BigModelProviderFactory();

/**
 * 注册 BigModel 提供者到全局注册表 (兼容旧接口)
 */
export function registerBigModelProvider(context: vscode.ExtensionContext): BigModelChatProvider {
	return bigmodelProviderFactory.createChatProvider(context);
}

/**
 * 初始化 BigModel 提供者注册
 * 在模块加载时调用，将工厂注册到 ProviderFactoryRegistry
 */
export function registerBigModelProviderFactory(): void {
	ProviderFactoryRegistry.getInstance().register(bigmodelProviderFactory);
}
