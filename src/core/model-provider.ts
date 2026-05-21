/**
 * 基础 Model Provider - 通用的模型提供商实现
 */

import vscode from 'vscode';
import type { ModelDefinition } from './models';
import { logger } from './logger';
import { BaseAuthManager } from './auth-manager';
import { ClientOptions, IApiClient } from './client';

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
	/** SecretStorage 键名 */
	apiKeySecretKey: string;
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
	createClient(apiKey: string, options?: ClientOptions): IApiClient;
}

/**
 * ModelProvider 配置
 */
export interface ModelProviderConfig {
	/** 提供商 ID */
	readonly providerId: string;
	/** 提供商显示名称 */
	readonly providerName: string;
	/** 配置节名称 */
	readonly configSection: string;
	/** 默认基础 URL */
	readonly defaultBaseUrl: string;
	/** 模型列表 */
	readonly models: ModelDefinition[];
	/** API 密钥提示文案 */
	readonly apiKeyPrompt?: string;
	/** API 密钥 placeholder */
	readonly apiKeyPlaceholder?: string;
	/** 创建 API 客户端工厂函数 */
	createClient(baseUrl: string, apiKey: string, options?: ClientOptions): IApiClient;
}

/**
 * 基础 ModelProvider 实现
 * 通用的模型提供商，封装所有 Provider 通用的逻辑
 */
export class BaseModelProvider implements IModelProvider {
	readonly config: ProviderConfig;
	readonly id: string;
	private readonly _context: vscode.ExtensionContext;
	private readonly _models: ModelDefinition[];
	private readonly _defaultBaseUrl: string;
	private readonly _configSection: string;
	private readonly _apiKeyPrompt: string;
	private readonly _apiKeyPlaceholder: string;
	private readonly _createClient: (baseUrl: string, apiKey: string, options?: ClientOptions) => IApiClient;

	private readonly _authManager: BaseAuthManager;

	constructor(context: vscode.ExtensionContext, config: ModelProviderConfig) {
		this._context = context;
		this.id = config.providerId;
		this._models = config.models;
		this._defaultBaseUrl = config.defaultBaseUrl;
		this._configSection = config.configSection;
		this._apiKeyPrompt = config.apiKeyPrompt ?? `Enter your ${config.providerName} API Key`;
		this._apiKeyPlaceholder = config.apiKeyPlaceholder ?? 'your-api-key-here';
		this._createClient = config.createClient;
		this._authManager = new BaseAuthManager(context, config.configSection, config.providerId);

		this.config = {
			vendorId: config.providerId,
			vendorName: config.providerName,
			baseUrl: config.defaultBaseUrl,
			apiKeySecretKey: `${config.configSection}.${config.providerId}.apiKey`,
		};

		logger.provider.debug(`[${this.id}] BaseModelProvider created`);
	}

	getApiKey(): Promise<string | undefined> {
		return this._authManager.getApiKey();
	}

	async hasApiKey(): Promise<boolean> {
		return this._authManager.hasApiKey();
	}

	async promptForApiKey(): Promise<boolean> {
		return this._authManager.promptForApiKey(this._apiKeyPrompt, this._apiKeyPlaceholder);
	}

	deleteApiKey(): Promise<void> {
		return this._authManager.deleteApiKey();
	}

	getModels(): ModelDefinition[] {
		logger.provider.debug(`[${this.id}] Returning ${this._models.length} models`);
		return this._models;
	}

	createClient(apiKey: string, options?: ClientOptions): IApiClient {
		const baseUrl = this.getBaseUrl();
		logger.provider.debug(`[${this.id}] Creating client, baseUrl: ${baseUrl}`);

		const config = vscode.workspace.getConfiguration(this._configSection);
		const timeoutMs = options?.timeoutMs ?? config.get<number>('timeoutMs') ?? 60_000;
		const maxRetries = options?.maxRetries ?? config.get<number>('maxRetries') ?? 1;

		return this._createClient(baseUrl, apiKey, { timeoutMs, maxRetries });
	}

	getBaseUrl(): string {
		const config = vscode.workspace.getConfiguration(this._configSection);
		const baseUrl = config.get<string>(`${this.id}.baseUrl`) || this._defaultBaseUrl;
		logger.provider.debug(`[${this.id}] getBaseUrl: ${baseUrl}`);
		return baseUrl;
	}

	getApiModelId(vscodeModelId: string): string {
		const config = vscode.workspace.getConfiguration(this._configSection);
		const overrides = config.get<Record<string, string>>('modelIdOverrides');
		const modelId = overrides?.[vscodeModelId]?.trim() || vscodeModelId;
		if (overrides?.[vscodeModelId]) {
			logger.provider.debug(`[${this.id}] Model ID override: ${vscodeModelId} -> ${modelId}`);
		}
		return modelId;
	}
}
