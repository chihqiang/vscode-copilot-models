/**
 * 基础 Chat Provider - 实现 vscode.LanguageModelChatProvider 的公共逻辑
 */

import vscode from 'vscode';
import type {
	ApiMessage,
	ApiRequest,
	ApiTool,
	ApiToolCall,
	ApiUsage,
	IModelProvider,
	ModelDefinition,
} from '../../core/interfaces';
import type { StreamCallbacks } from '../../core/interfaces';
import { logger } from '../../core/logger';

/**
 * 思考模式努力程度
 */
export type ThinkingEffort = 'none' | 'low' | 'high' | 'max';

/**
 * 模型配置选项
 */
export type ModelConfigurationOptions = vscode.ProvideLanguageModelChatResponseOptions & {
	readonly modelConfiguration?: Record<string, unknown>;
	readonly configuration?: Record<string, unknown>;
};

/**
 * 模型选择器信息
 */
export type ModelPickerChatInformation = vscode.LanguageModelChatInformation & {
	readonly isUserSelectable: boolean;
	readonly statusIcon?: vscode.ThemeIcon;
	readonly configurationSchema?: {
		properties: Record<string, unknown>;
	};
};

/**
 * 对话段信息
 */
export interface ConversationSegment {
	index: number;
	id: string;
	timestamp: number;
}

/**
 * 准备好的聊天请求
 */
export interface PreparedChatRequest {
	request: ApiRequest;
	modelDefinition: ModelDefinition | undefined;
	apiMessages: ApiMessage[];
	tools?: ApiTool[];
	isThinkingModel: boolean;
	thinkingEffort: ThinkingEffort;
}

/**
 * 思考模式配置 schema
 */
export function buildThinkingEffortSchema() {
	return {
		properties: {
			reasoningEffort: {
				type: 'string',
				title: 'Thinking Effort',
				enum: ['none', 'low', 'high', 'max'],
				enumItemLabels: ['None', 'Low', 'High', 'Max'],
				enumDescriptions: [
					'Disable thinking mode',
					'Low reasoning effort',
					'High reasoning effort',
					'Maximum reasoning effort',
				],
				default: 'high',
				group: 'navigation',
			},
		},
	};
}

/**
 * ChatProvider 配置
 */
export interface ChatProviderConfig {
	/** 提供商 ID */
	readonly providerId: string;
	/** 提供商显示名称 */
	readonly providerName: string;
	/** 配置节名称 */
	readonly configSection: string;
	/** 是否支持思考模式 (可选，默认 false) */
	readonly supportsThinking?: boolean;
}

/**
 * 基础 Chat Provider 实现
 */
export abstract class BaseChatProvider implements vscode.LanguageModelChatProvider, vscode.Disposable {
	protected readonly globalStorageUri: vscode.Uri;
	protected readonly onDidChangeLanguageModelChatInformationEmitter = new vscode.EventEmitter<void>();
	protected readonly providerId: string;
	protected readonly providerName: string;
	protected readonly configSection: string;
	protected readonly supportsThinking: boolean;
	protected isActive = true;
	private disposables: vscode.Disposable[] = [];

	readonly onDidChangeLanguageModelChatInformation =
		this.onDidChangeLanguageModelChatInformationEmitter.event;

	constructor(
		protected readonly context: vscode.ExtensionContext,
		protected readonly modelProvider: IModelProvider,
	) {
		this.globalStorageUri = context.globalStorageUri;
		this.providerId = modelProvider.id;
		this.providerName = modelProvider.config.vendorName;
		this.configSection = this.getConfigSection();
		this.supportsThinking = this.getSupportsThinking();

		logger.provider.info(`[${this.providerId}] ChatProvider initialized`);

		this.disposables.push(
			this.onDidChangeLanguageModelChatInformationEmitter,
			vscode.workspace.onDidChangeConfiguration((e) => {
				this.onConfigurationChanged(e);
			}),
			context.secrets.onDidChange((e) => {
				this.onSecretsChanged(e);
			}),
		);
	}

	/**
	 * 获取配置节名称 (子类可重写)
	 */
	protected getConfigSection(): string {
		return 'copilot-models';
	}

	/**
	 * 获取是否支持思考模式 (子类可重写)
	 */
	protected getSupportsThinking(): boolean {
		return false;
	}

	/**
	 * 释放资源
	 */
	dispose(): void {
		logger.provider.info(`[${this.providerId}] Disposing ChatProvider...`);
		this.disposables.forEach((d) => d.dispose());
		this.disposables = [];
	}

	/**
	 * 配置变更时调用
	 */
	protected onConfigurationChanged(e: vscode.ConfigurationChangeEvent): void {
		if (this.isActive && this.affectsConfiguration(e)) {
			logger.config.info(`[${this.providerId}] Configuration affects this provider, refreshing...`);
			this.onDidChangeLanguageModelChatInformationEmitter.fire();
		}
	}

	/**
	 * 检查是否影响本 provider 的配置 (子类可重写)
	 */
	protected affectsConfiguration(e: vscode.ConfigurationChangeEvent): boolean {
		const lowerId = this.providerId.charAt(0).toLowerCase() + this.providerId.slice(1);
		return (
			e.affectsConfiguration(`${this.configSection}.${lowerId}BaseUrl`) ||
			e.affectsConfiguration(`${this.configSection}.modelIdOverrides`) ||
			e.affectsConfiguration(`${this.configSection}.${lowerId}ApiKey`)
		);
	}

	/**
	 * 密钥变更时调用
	 */
	protected onSecretsChanged(e: vscode.SecretStorageChangeEvent): void {
		logger.auth.debug(`[${this.providerId}] Secret changed: ${e.key}`);
		if (this.isActive && this.affectsSecretKey(e)) {
			logger.auth.info(`[${this.providerId}] Secret affects this provider, refreshing...`);
			this.onDidChangeLanguageModelChatInformationEmitter.fire();
		}
	}

	/**
	 * 检查是否影响本 provider 的密钥 (子类可重写)
	 */
	protected affectsSecretKey(e: vscode.SecretStorageChangeEvent): boolean {
		return e.key === this.modelProvider.config.apiKeySecretKey;
	}

	/**
	 * 获取模型选择器信息
	 */
	async provideLanguageModelChatInformation(
		_options: vscode.PrepareLanguageModelChatModelOptions,
		_token: vscode.CancellationToken,
	): Promise<vscode.LanguageModelChatInformation[]> {
		if (!this.isActive) {
			logger.provider.debug(`[${this.providerId}] Provider is not active, returning empty`);
			return [];
		}

		const hasApiKey = await this.modelProvider.hasApiKey();
		const models = this.modelProvider.getModels();
		logger.provider.info(`[${this.providerId}] Providing model information, count: ${models.length}, hasApiKey: ${hasApiKey}`);

		return models.map((model) => this.toChatInfo(model, hasApiKey));
	}

	/**
	 * 将模型定义转换为 Chat 信息 (子类可重写)
	 */
	protected toChatInfo(model: ModelDefinition, hasApiKey: boolean): ModelPickerChatInformation {
		logger.provider.debug(`[${this.providerId}] Converting model to chat info: ${model.id}, hasApiKey: ${hasApiKey}`);
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
			...(this.supportsThinking && model.capabilities.thinking ? { configurationSchema: buildThinkingEffortSchema() } : {}),
		};
	}

	/**
	 * 获取对话段信息
	 */
	protected resolveConversationSegment(messages: readonly vscode.LanguageModelChatRequestMessage[]): ConversationSegment {
		if (messages.length === 0) {
			logger.chat.debug('No messages, creating new segment');
			return { index: 0, id: `seg-${Date.now()}`, timestamp: Date.now() };
		}

		let latestTimestamp = 0;
		let index = 0;
		for (let i = messages.length - 1; i >= 0; i--) {
			const msg = messages[i];
			// @ts-expect-error timestamp 是内部属性
			if (msg.timestamp && typeof msg.timestamp === 'number') {
				// @ts-expect-error timestamp 是内部属性
				latestTimestamp = msg.timestamp;
				index = i;
				break;
			}
		}

		const segment = {
			index,
			id: `seg-${latestTimestamp || Date.now()}`,
			timestamp: latestTimestamp || Date.now(),
		};
		logger.chat.debug(`Resolved segment: ${segment.id}, index: ${segment.index}`);
		return segment;
	}

	/**
	 * 准备聊天请求
	 */
	protected async prepareChatRequest(
		modelInfo: vscode.LanguageModelChatInformation,
		messages: readonly vscode.LanguageModelChatRequestMessage[],
		options: vscode.ProvideLanguageModelChatResponseOptions,
	): Promise<PreparedChatRequest> {
		logger.chat.info(`[${this.providerId}] Preparing chat request, model: ${modelInfo.id}`);

		const apiKey = await this.modelProvider.getApiKey();
		if (!apiKey) {
			logger.chat.error(`[${this.providerId}] API key not configured`);
			throw new Error('API key not configured');
		}

		const modelDefinition = this.modelProvider.getModels().find((m) => m.id === modelInfo.id);
		const isThinkingModel = modelDefinition?.capabilities.thinking ?? false;
		const thinkingEffort = this.getConfiguredThinkingEffort(options as ModelConfigurationOptions);

		logger.chat.debug(`[${this.providerId}] Model: ${modelInfo.id}, isThinkingModel: ${isThinkingModel}, thinkingEffort: ${thinkingEffort}`);

		const apiMessages = this.convertMessages(messages, isThinkingModel);
		const tools = modelDefinition?.capabilities.toolCalling
			? this.convertTools(options.tools)
			: undefined;

		logger.chat.debug(`[${this.providerId}] Original messages count: ${messages.length}`);

		const request: ApiRequest = {
			model: this.getApiModelId(modelInfo.id),
			messages: apiMessages,
			stream: true,
			tools,
			tool_choice: tools && tools.length > 0 ? 'auto' : undefined,
		};

		// 如果是思考模型，添加思考相关参数
		if (isThinkingModel) {
			this.convertThinkingParams(request, thinkingEffort);
		}

		logger.chat.debug(`[${this.providerId}] Prepared request with ${apiMessages.length} messages, tools: ${tools?.length ?? 0}`);

		return {
			request,
			modelDefinition,
			apiMessages,
			tools,
			isThinkingModel,
			thinkingEffort,
		};
	}

	/**
	 * 获取配置的思考努力程度
	 */
	protected getConfiguredThinkingEffort(options: ModelConfigurationOptions): ThinkingEffort {
		const configuredEffort =
			options.modelConfiguration?.reasoningEffort ?? options.configuration?.reasoningEffort;

		if (configuredEffort === 'none') {
			return 'none';
		}
		if (configuredEffort === 'high') {
			return 'high';
		}
		if (configuredEffort === 'max') {
			return 'max';
		}
		if (configuredEffort === 'low') {
			return 'low';
		}
		return 'high'; // 默认值
	}

	/**
	 * 获取 API 模型 ID
	 */
	protected getApiModelId(vscodeModelId: string): string {
		if ('getApiModelId' in this.modelProvider && typeof this.modelProvider.getApiModelId === 'function') {
			return this.modelProvider.getApiModelId(vscodeModelId);
		}
		return vscodeModelId;
	}

	/**
	 * 转换思考参数到 API 特定格式 (子类可重写)
	 */
	protected convertThinkingParams(request: ApiRequest, effort: ThinkingEffort): void {
		// 默认实现：使用 reasoning_effort 参数
		if (effort !== 'none') {
			(request as ApiRequest & { reasoning_effort?: string }).reasoning_effort = effort;
		}
	}

	/**
	 * 转换消息格式 (子类可重写)
	 */
	protected convertMessages(
		messages: readonly vscode.LanguageModelChatRequestMessage[],
		_isThinkingModel: boolean,
	): ApiMessage[] {
		logger.chat.debug(`[${this.providerId}] Converting ${messages.length} messages`);

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

		logger.chat.debug(`[${this.providerId}] Converted to ${result.length} API messages`);
		return result;
	}

	/**
	 * 映射 VS Code 消息角色到 API 角色
	 */
	protected mapRole(role: vscode.LanguageModelChatMessageRole): string {
		switch (role) {
			case vscode.LanguageModelChatMessageRole.User:
				return 'user';
			case vscode.LanguageModelChatMessageRole.Assistant:
				return 'assistant';
			default:
				return 'user';
		}
	}

	/**
	 * 转换工具定义
	 */
	protected convertTools(
		tools: readonly vscode.LanguageModelChatTool[] | undefined,
	): ApiTool[] | undefined {
		if (!tools || tools.length === 0) {
			return undefined;
		}

		return tools.map((tool) => ({
			type: 'function' as const,
			function: {
				name: tool.name,
				description: tool.description,
				parameters: tool.inputSchema as Record<string, unknown> | undefined,
			},
		}));
	}

	/**
	 * 发送流式聊天补全请求 (子类可重写)
	 */
	protected async sendStreamRequest(
		request: ApiRequest,
		progress: vscode.Progress<vscode.LanguageModelResponsePart>,
		token: vscode.CancellationToken,
	): Promise<void> {
		logger.chat.info(`[${this.providerId}] Sending stream request, model: ${request.model}`);

		const apiKey = await this.modelProvider.getApiKey();
		if (!apiKey) {
			logger.chat.error(`[${this.providerId}] API key not configured`);
			throw new Error(`${this.providerName} API key not configured`);
		}

		try {
			const client = this.modelProvider.createClient(apiKey);
			const callbacks = this.createStreamCallbacks(progress);
			await client.streamChatCompletion(request, callbacks, token);
		} catch (error) {
			if (error instanceof Error && error.message.includes('timeout')) {
				logger.chat.error(`[${this.providerId}] Request timeout`);
				throw new Error(`${this.providerName} request timeout, please try again`);
			}
			throw error;
		}
	}

	/**
	 * 创建流式回调
	 */
	protected createStreamCallbacks(progress: vscode.Progress<vscode.LanguageModelResponsePart>): StreamCallbacks {
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
				logger.stream.error(`[${this.providerId}] Stream error: ${error.message}`);
				throw error;
			},
			onDone: () => {
				// 打印完整响应内容
				if (content) {
					logger.stream.debug(`[${this.providerId}] === Response Content ===\n${content}`);
				}

				// 打印思考内容
				if (thinking) {
					logger.stream.debug(`[${this.providerId}] === Thinking Content ===\n${thinking}`);
				}

				// 打印工具调用
				if (toolCalls.length > 0) {
					logger.stream.debug(`[${this.providerId}] === Tool Calls (${toolCalls.length}) ===`);
					for (const tc of toolCalls) {
						logger.stream.debug(`  - ${tc.name}: ${tc.args}`);
					}
				}

				// 打印 Token 使用统计
				if (finalUsage) {
					logger.stream.debug(
						`[${this.providerId}] === Token Usage ===\n` +
							`  prompt_tokens: ${finalUsage.prompt_tokens}\n` +
							`  completion_tokens: ${finalUsage.completion_tokens}\n` +
							`  total_tokens: ${finalUsage.total_tokens}`,
					);
				}
			},
		};
	}

	/**
	 * 提供聊天响应
	 */
	async provideLanguageModelChatResponse(
		modelInfo: vscode.LanguageModelChatInformation,
		messages: readonly vscode.LanguageModelChatRequestMessage[],
		options: vscode.ProvideLanguageModelChatResponseOptions,
		progress: vscode.Progress<vscode.LanguageModelResponsePart>,
		token: vscode.CancellationToken,
	): Promise<void> {
		const startTime = Date.now();
		logger.chat.info(`[${this.providerId}] provideLanguageModelChatResponse called, model: ${modelInfo.id}`);
		try {
			const prepared = await this.prepareChatRequest(modelInfo, messages, options);
			await this.sendStreamRequest(prepared.request, progress, token);
			const duration = Date.now() - startTime;
			logger.chat.info(`[${this.providerId}] Chat response completed successfully, duration: ${duration}ms`);
		} catch (error) {
			logger.chat.error(`[${this.providerId}] Chat response failed:`, error);
			throw error;
		}
	}

	/**
	 * 提供令牌计数估算
	 */
	async provideTokenCount(
		_modelInfo: vscode.LanguageModelChatInformation,
		text: string | vscode.LanguageModelChatRequestMessage,
		_token: vscode.CancellationToken,
	): Promise<number> {
		const content = typeof text === 'string' ? text : this.extractTextFromMessage(text);
		return Math.ceil(content.length / 4); // 简单估算：4 字符约等于 1 token
	}

	/**
	 * 从消息中提取文本内容
	 */
	private extractTextFromMessage(message: vscode.LanguageModelChatRequestMessage): string {
		let text = '';
		for (const part of message.content) {
			if (part instanceof vscode.LanguageModelTextPart) {
				text += part.value;
			}
		}
		return text;
	}

	/**
	 * 刷新模型选择器
	 */
	refreshModelPicker(): void {
		logger.provider.info(`[${this.providerId}] Refreshing model picker`);
		this.onDidChangeLanguageModelChatInformationEmitter.fire();
	}

	/**
	 * 准备停用
	 */
	async prepareForDeactivate(): Promise<void> {
		logger.provider.info(`[${this.providerId}] Preparing for deactivation`);
		this.isActive = false;
		this.onDidChangeLanguageModelChatInformationEmitter.fire();
	}

	/**
	 * 配置 API 密钥
	 */
	async configureApiKey(): Promise<void> {
		logger.auth.info(`[${this.providerId}] Configuring API key...`);
		const saved = await this.modelProvider.promptForApiKey();
		if (saved) {
			logger.auth.info(`[${this.providerId}] API key configured successfully`);
			this.refreshModelPicker();
		} else {
			logger.auth.info(`[${this.providerId}] API key configuration cancelled`);
		}
	}

	/**
	 * 清除 API 密钥
	 */
	async clearApiKey(): Promise<void> {
		logger.auth.info(`[${this.providerId}] Clearing API key...`);
		await this.modelProvider.deleteApiKey();
		this.refreshModelPicker();
		vscode.window.showInformationMessage(`${this.providerName} API key cleared`);
	}

	/**
	 * 刷新模型列表
	 */
	async refreshModels(): Promise<void> {
		logger.provider.info(`[${this.providerId}] Refreshing models...`);
		this.refreshModelPicker();
	}
}
