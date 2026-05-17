/**
 * 多模型 Copilot 扩展的核心接口定义
 */

import vscode from 'vscode';

/**
 * Chat Provider 接口 (简化版，用于类型检查)
 * 继承 VS Code LanguageModelChatProvider 并扩展额外方法
 */
export interface IChatProvider extends vscode.LanguageModelChatProvider {
	/** 刷新模型选择器 */
	refreshModelPicker(): void;
	/** 准备停用 */
	prepareForDeactivate(): Promise<void>;
	/** 释放资源 */
	dispose(): void;
	/** 配置 API 密钥 */
	configureApiKey(): Promise<void>;
	/** 清除 API 密钥 */
	clearApiKey(): Promise<void>;
}

/**
 * 模型能力定义
 */
export interface ModelCapabilities {
	/** 是否支持工具调用 */
	toolCalling: boolean;
	/** 是否支持图片输入 */
	imageInput: boolean;
	/** 是否支持思考模式 (reasoning) */
	thinking: boolean;
}

/**
 * 模型定义接口
 */
export interface ModelDefinition {
	/** 模型唯一标识符 (在 VS Code 中的 ID) */
	id: string;
	/** 模型显示名称 */
	name: string;
	/** 模型家族 (如 deepseek, openai 等) */
	family: string;
	/** 模型版本 */
	version: string;
	/** 模型详细描述 */
	detail: string;
	/** 最大输入令牌数 */
	maxInputTokens: number;
	/** 最大输出令牌数 */
	maxOutputTokens: number;
	/** 模型能力 */
	capabilities: ModelCapabilities;
	/** 是否需要 thinking 参数 */
	requiresThinkingParam?: boolean;
}

/**
 * API 消息格式
 */
export interface ApiMessage {
	role: 'system' | 'user' | 'assistant' | 'tool';
	content: string;
	tool_call_id?: string;
	tool_calls?: ApiToolCall[];
	reasoning_content?: string;
}

/**
 * API 工具调用格式
 */
export interface ApiToolCall {
	id: string;
	type: 'function';
	function: {
		name: string;
		arguments: string;
	};
}

/**
 * API 工具定义格式
 */
export interface ApiTool {
	type: 'function';
	function: {
		name: string;
		description?: string;
		parameters?: Record<string, unknown>;
	};
}

/**
 * API 令牌使用统计
 */
export interface ApiUsage {
	prompt_tokens: number;
	completion_tokens: number;
	total_tokens: number;
	[key: string]: number;
}

/**
 * API 请求格式
 */
export interface ApiRequest {
	model: string;
	messages: ApiMessage[];
	stream: boolean;
	temperature?: number;
	top_p?: number;
	max_tokens?: number;
	tools?: ApiTool[];
	tool_choice?: 'none' | 'auto' | 'required';
	thinking?: { type: 'enabled' | 'disabled' };
	reasoning_effort?: string;
	stream_options?: {
		include_usage: boolean;
	};
	[key: string]: unknown;
}

/**
 * 流式响应块
 */
export interface StreamChunk {
	id: string;
	object: string;
	created: number;
	model: string;
	choices: Array<{
		index: number;
		delta: {
			role?: string;
			content?: string;
			reasoning_content?: string;
			tool_calls?: Array<{
				index: number;
				id?: string;
				type?: string;
				function?: {
					name?: string;
					arguments?: string;
				};
			}>;
		};
		finish_reason: string | null;
	}>;
	usage?: ApiUsage;
}

/**
 * 流式响应回调接口
 */
export interface StreamCallbacks {
	onContent: (content: string) => void;
	onThinking: (text: string) => void;
	onToolCall: (toolCall: ApiToolCall) => void;
	onError: (error: Error) => void;
	onDone: () => void;
	onUsage?: (usage: ApiUsage) => void;
}

/**
 * 模型提供商配置信息
 */
export interface ProviderConfig {
	/** 提供商 ID (vendor name) */
	vendorId: string;
	/** 提供商显示名称 */
	vendorName: string;
	/** API 基础 URL */
	baseUrl: string;
	/** API 密钥配置项名称 */
	apiKeyConfigKey: string;
	/** SecretStorage 键名 */
	apiKeySecretKey: string;
	/** 模型 ID 覆盖配置键 */
	modelIdOverridesConfigKey?: string;
}

/**
 * 模型提供商接口
 */
export interface IModelProvider {
	/** 提供商配置 */
	readonly config: ProviderConfig;
	/** 提供商 ID */
	readonly id: string;
	/** 获取 API 密钥 */
	getApiKey(): Promise<string | undefined>;
	/** 检查是否已配置 API 密钥 */
	hasApiKey(): Promise<boolean>;
	/** 提示用户输入 API 密钥 */
	promptForApiKey(): Promise<boolean>;
	/** 删除已存储的 API 密钥 */
	deleteApiKey(): Promise<void>;
	/** 获取该提供商的模型列表 */
	getModels(): ModelDefinition[];
	/** 获取 API 客户端 */
	createClient(apiKey: string): IApiClient;
}

/**
 * API 客户端接口
 */
export interface IApiClient {
	/** 基础 URL */
	readonly baseUrl: string;
	/** API 密钥 */
	readonly apiKey: string;
	/** 发送流式聊天补全请求 */
	streamChatCompletion(
		request: ApiRequest,
		callbacks: StreamCallbacks,
		cancellationToken?: import('vscode').CancellationToken,
	): Promise<void>;
}

/**
 * 消息转换器接口
 */
export interface IMessageConverter {
	/**
	 * 将 VS Code 消息转换为 API 格式
	 */
	convertMessages(
		messages: readonly import('vscode').LanguageModelChatRequestMessage[],
		isThinkingModel: boolean,
	): ApiMessage[];

	/**
	 * 将 VS Code 工具定义转换为 API 格式
	 */
	convertTools(tools: readonly import('vscode').LanguageModelChatTool[] | undefined): ApiTool[] | undefined;

	/**
	 * 计算消息总字符数
	 */
	countMessageChars(messages: ApiMessage[]): number;
}
