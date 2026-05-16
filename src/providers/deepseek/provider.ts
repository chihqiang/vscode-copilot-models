/**
 * DeepSeek 模型提供者
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
import { logger } from '../../core/logger';
import { ModelRegistry } from '../../core/registry';
import { BaseAuthManager } from '../base/auth-manager';
import { BaseChatProvider, type ModelPickerChatInformation } from '../base/chat-provider';
import { DeepSeekClient } from './client';
import {
	DEEPSEEK_CONFIG_SECTION,
	DEEPSEEK_DEFAULT_BASE_URL,
	DEEPSEEK_MODELS,
	DEEPSEEK_PROVIDER_ID,
} from './models';

/**
 * DeepSeek 认证管理器
 */
class DeepSeekAuthManager extends BaseAuthManager {
	constructor(context: vscode.ExtensionContext) {
		super(context, DEEPSEEK_CONFIG_SECTION, DEEPSEEK_PROVIDER_ID);
		logger.deepseek.debug('DeepSeekAuthManager created');
	}

	override async promptForApiKey(): Promise<boolean> {
		logger.deepseek.info('Prompting for DeepSeek API key...');
		return super.promptForApiKey(
			'Enter your DeepSeek API Key',
			'sk-xxxxxxxxxxxxxxxxxxxxxxxx',
		);
	}
}

/**
 * DeepSeek 模型提供商
 */
export class DeepSeekModelProvider implements IModelProvider {
	readonly config: ProviderConfig = {
		vendorId: DEEPSEEK_PROVIDER_ID,
		vendorName: 'DeepSeek',
		baseUrl: DEEPSEEK_DEFAULT_BASE_URL,
		apiKeyConfigKey: `${DEEPSEEK_CONFIG_SECTION}.deepseekApiKey`,
		apiKeySecretKey: `${DEEPSEEK_CONFIG_SECTION}.deepseek.apiKey`,
		modelIdOverridesConfigKey: `${DEEPSEEK_CONFIG_SECTION}.modelIdOverrides`,
	};

	readonly id = DEEPSEEK_PROVIDER_ID;
	private readonly authManager: DeepSeekAuthManager;

	constructor(context: vscode.ExtensionContext) {
		logger.deepseek.info('Creating DeepSeekModelProvider...');
		this.authManager = new DeepSeekAuthManager(context);
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
		logger.deepseek.debug(`Returning ${DEEPSEEK_MODELS.length} models`);
		return DEEPSEEK_MODELS;
	}

	createClient(apiKey: string): DeepSeekClient {
		const baseUrl = this.getBaseUrl();
		logger.deepseek.debug(`Creating DeepSeekClient, baseUrl: ${baseUrl}`);
		return new DeepSeekClient(baseUrl, apiKey);
	}

	getBaseUrl(): string {
		const config = vscode.workspace.getConfiguration(DEEPSEEK_CONFIG_SECTION);
		const baseUrl = config.get<string>('deepseekBaseUrl') || DEEPSEEK_DEFAULT_BASE_URL;
		logger.deepseek.debug(`getBaseUrl: ${baseUrl}`);
		return baseUrl;
	}

	getApiModelId(vscodeModelId: string): string {
		const config = vscode.workspace.getConfiguration(DEEPSEEK_CONFIG_SECTION);
		const overrides = config.get<Record<string, string>>('modelIdOverrides');
		const modelId = overrides?.[vscodeModelId]?.trim() || vscodeModelId;
		if (overrides?.[vscodeModelId]) {
			logger.deepseek.debug(`Model ID override: ${vscodeModelId} -> ${modelId}`);
		}
		return modelId;
	}
}

/**
 * DeepSeek Chat Provider 实现
 */
export class DeepSeekChatProvider extends BaseChatProvider {
	readonly modelProvider: DeepSeekModelProvider;

	constructor(context: vscode.ExtensionContext) {
		super(context, new DeepSeekModelProvider(context));
		this.modelProvider = this.provider as DeepSeekModelProvider;
		logger.deepseek.info('DeepSeekChatProvider created');
	}

	protected override affectsConfiguration(e: vscode.ConfigurationChangeEvent): boolean {
		return (
			e.affectsConfiguration(`${DEEPSEEK_CONFIG_SECTION}.deepseekBaseUrl`) ||
			e.affectsConfiguration(`${DEEPSEEK_CONFIG_SECTION}.modelIdOverrides`) ||
			e.affectsConfiguration(`${DEEPSEEK_CONFIG_SECTION}.deepseekApiKey`)
		);
	}

	protected override affectsSecretKey(e: vscode.SecretStorageChangeEvent): boolean {
		return e.key === this.modelProvider.config.apiKeySecretKey;
	}

	protected override toChatInfo(model: ModelDefinition, hasApiKey: boolean): ModelPickerChatInformation {
		logger.deepseek.debug(`Converting model to chat info: ${model.id}, hasApiKey: ${hasApiKey}`);
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
			...(model.capabilities.thinking ? { configurationSchema: this.buildThinkingEffortSchema() } : {}),
		};
	}

	private buildThinkingEffortSchema() {
		return {
			properties: {
				reasoningEffort: {
					type: 'string',
					title: 'Thinking Effort',
					enum: ['none', 'high', 'max'],
					enumItemLabels: ['None', 'High', 'Max'],
					enumDescriptions: [
						'Disable thinking mode',
						'High reasoning effort',
						'Maximum reasoning effort',
					],
					default: 'high',
					group: 'navigation',
				},
			},
		};
	}

	protected override getApiModelId(vscodeModelId: string): string {
		return this.modelProvider.getApiModelId(vscodeModelId);
	}

	protected override convertMessages(
		messages: readonly vscode.LanguageModelChatRequestMessage[],
		_isThinkingModel: boolean,
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
		logger.deepseek.info(`Sending stream request, model: ${request.model}`);

		const apiKey = await this.modelProvider.getApiKey();
		if (!apiKey) {
			logger.deepseek.error('DeepSeek API key not configured');
			throw new Error('DeepSeek API key not configured');
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
				logger.deepseek.error(`Stream error: ${error.message}`);
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
		logger.deepseek.info('Configuring API key...');
		const saved = await this.modelProvider.promptForApiKey();
		if (saved) {
			logger.deepseek.info('API key configured successfully');
			this.refreshModelPicker();
		} else {
			logger.deepseek.info('API key configuration cancelled');
		}
	}

	/**
	 * 清除 API 密钥
	 */
	async clearApiKey(): Promise<void> {
		logger.deepseek.info('Clearing API key...');
		await this.modelProvider.deleteApiKey();
		this.refreshModelPicker();
		vscode.window.showInformationMessage('DeepSeek API key cleared');
	}

	/**
	 * 刷新模型列表
	 */
	async refreshModels(): Promise<void> {
		logger.deepseek.info('Refreshing models...');
		this.refreshModelPicker();
	}
}

/**
 * 注册 DeepSeek 提供者到全局注册表
 */
export function registerDeepSeekProvider(context: vscode.ExtensionContext): DeepSeekChatProvider {
	logger.deepseek.info('Registering DeepSeek provider...');
	const chatProvider = new DeepSeekChatProvider(context);

	// 注册到模型注册表
	ModelRegistry.getInstance().registerProvider(chatProvider.modelProvider);

	logger.deepseek.info('DeepSeek provider registered successfully');
	return chatProvider;
}
