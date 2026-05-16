/**
 * 基础 Chat Provider - 实现 vscode.LanguageModelChatProvider 的公共逻辑
 */

import vscode from 'vscode';
import type {
	ApiMessage,
	ApiRequest,
	ApiTool,
	ApiToolCall,
	IModelProvider,
	ModelDefinition,
} from '../../core/interfaces';
import { logger } from '../../core/logger';

/**
 * 思考模式努力程度
 */
export type ThinkingEffort = 'none' | 'high' | 'max';

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
 * 基础 Chat Provider 实现
 */
export abstract class BaseChatProvider implements vscode.LanguageModelChatProvider, vscode.Disposable {
	protected readonly globalStorageUri: vscode.Uri;
	protected readonly onDidChangeLanguageModelChatInformationEmitter = new vscode.EventEmitter<void>();
	protected isActive = true;
	private disposables: vscode.Disposable[] = [];

	readonly onDidChangeLanguageModelChatInformation =
		this.onDidChangeLanguageModelChatInformationEmitter.event;

	constructor(
		protected readonly context: vscode.ExtensionContext,
		protected readonly provider: IModelProvider,
	) {
		this.globalStorageUri = context.globalStorageUri;
		logger.provider.info(`[${provider.id}] ChatProvider initialized`);

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
	 * 释放资源
	 */
	dispose(): void {
		logger.provider.info(`[${this.provider.id}] Disposing ChatProvider...`);
		this.disposables.forEach((d) => d.dispose());
		this.disposables = [];
	}

	/**
	 * 配置变更时调用
	 */
	protected onConfigurationChanged(e: vscode.ConfigurationChangeEvent): void {
		const modelOverrideKey = this.provider.config.modelIdOverridesConfigKey;
		logger.config.debug(`[${this.provider.id}] Configuration changed, modelOverrideKey: ${modelOverrideKey ?? 'not set'}`);
		if (this.isActive && this.affectsConfiguration(e)) {
			logger.config.info(`[${this.provider.id}] Configuration affects this provider, refreshing...`);
			this.onDidChangeLanguageModelChatInformationEmitter.fire();
		}
	}

	/**
	 * 检查是否影响本 provider 的配置
	 */
	protected abstract affectsConfiguration(e: vscode.ConfigurationChangeEvent): boolean;

	/**
	 * 密钥变更时调用
	 */
	protected onSecretsChanged(e: vscode.SecretStorageChangeEvent): void {
		logger.auth.debug(`[${this.provider.id}] Secret changed: ${e.key}`);
		if (this.isActive && this.affectsSecretKey(e)) {
			logger.auth.info(`[${this.provider.id}] Secret affects this provider, refreshing...`);
			this.onDidChangeLanguageModelChatInformationEmitter.fire();
		}
	}

	/**
	 * 检查是否影响本 provider 的密钥
	 */
	protected abstract affectsSecretKey(e: vscode.SecretStorageChangeEvent): boolean;

	/**
	 * 获取模型选择器信息
	 */
	async provideLanguageModelChatInformation(
		_options: vscode.PrepareLanguageModelChatModelOptions,
		_token: vscode.CancellationToken,
	): Promise<vscode.LanguageModelChatInformation[]> {
		if (!this.isActive) {
			logger.provider.debug(`[${this.provider.id}] Provider is not active, returning empty`);
			return [];
		}

		const hasApiKey = await this.provider.hasApiKey();
		const models = this.provider.getModels();
		logger.provider.info(`[${this.provider.id}] Providing model information, count: ${models.length}, hasApiKey: ${hasApiKey}`);

		return models.map((model) => this.toChatInfo(model, hasApiKey));
	}

	/**
	 * 将模型定义转换为 Chat 信息
	 */
	protected abstract toChatInfo(model: ModelDefinition, hasApiKey: boolean): ModelPickerChatInformation;

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
		logger.chat.info(`[${this.provider.id}] Preparing chat request, model: ${modelInfo.id}`);

		const apiKey = await this.provider.getApiKey();
		if (!apiKey) {
			logger.chat.error(`[${this.provider.id}] API key not configured`);
			throw new Error('API key not configured');
		}

		const modelDefinition = this.provider.getModels().find((m) => m.id === modelInfo.id);
		const isThinkingModel = modelDefinition?.capabilities.thinking ?? false;
		const thinkingEffort = this.getConfiguredThinkingEffort(options as ModelConfigurationOptions);

		logger.chat.debug(`[${this.provider.id}] Model: ${modelInfo.id}, isThinkingModel: ${isThinkingModel}, thinkingEffort: ${thinkingEffort}`);

		const apiMessages = this.convertMessages(messages, isThinkingModel);
		const tools = modelDefinition?.capabilities.toolCalling
			? this.convertTools(options.tools)
			: undefined;

		const request: ApiRequest = {
			model: this.getApiModelId(modelInfo.id),
			messages: apiMessages,
			stream: true,
			tools,
			tool_choice: tools && tools.length > 0 ? 'auto' : undefined,
		};

		// 如果是思考模型，添加思考相关参数
		if (isThinkingModel) {
			(request as ApiRequest & { thinking?: { type: 'enabled' | 'disabled' }; reasoning_effort?: string }).thinking = {
				type: thinkingEffort === 'none' ? 'disabled' : 'enabled',
			};
			if (thinkingEffort !== 'none') {
				(request as ApiRequest & { reasoning_effort?: string }).reasoning_effort = thinkingEffort;
			}
		}

		logger.chat.debug(`[${this.provider.id}] Prepared request with ${apiMessages.length} messages, tools: ${tools?.length ?? 0}`);

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
		return 'high'; // 默认值
	}

	/**
	 * 获取 API 模型 ID
	 */
	protected abstract getApiModelId(vscodeModelId: string): string;

	/**
	 * 转换消息格式
	 */
	protected abstract convertMessages(
		messages: readonly vscode.LanguageModelChatRequestMessage[],
		isThinkingModel: boolean,
	): ApiMessage[];

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
	 * 发送流式聊天补全请求
	 */
	protected abstract sendStreamRequest(
		request: ApiRequest,
		progress: vscode.Progress<vscode.LanguageModelResponsePart>,
		token: vscode.CancellationToken,
	): Promise<void>;

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
		logger.chat.info(`[${this.provider.id}] provideLanguageModelChatResponse called, model: ${modelInfo.id}`);
		try {
			const prepared = await this.prepareChatRequest(modelInfo, messages, options);
			await this.sendStreamRequest(prepared.request, progress, token);
			logger.chat.info(`[${this.provider.id}] Chat response completed successfully`);
		} catch (error) {
			logger.chat.error(`[${this.provider.id}] Chat response failed:`, error);
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
		logger.provider.info(`[${this.provider.id}] Refreshing model picker`);
		this.onDidChangeLanguageModelChatInformationEmitter.fire();
	}

	/**
	 * 准备停用
	 */
	async prepareForDeactivate(): Promise<void> {
		logger.provider.info(`[${this.provider.id}] Preparing for deactivation`);
		this.isActive = false;
		this.onDidChangeLanguageModelChatInformationEmitter.fire();
	}
}
