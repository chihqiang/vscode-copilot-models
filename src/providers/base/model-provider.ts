/**
 * 基础 Model Provider - 通用的模型提供商实现
 */

import vscode from 'vscode';
import type { IApiClient, IModelProvider, ModelDefinition, ProviderConfig } from '../../core/interfaces';
import { logger } from '../../core/logger';

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
	createClient(baseUrl: string, apiKey: string): IApiClient;
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
	private readonly _createClient: (baseUrl: string, apiKey: string) => IApiClient;
	private readonly _lowerId: string;

	constructor(context: vscode.ExtensionContext, config: ModelProviderConfig) {
		this._context = context;
		this.id = config.providerId;
		this._models = config.models;
		this._defaultBaseUrl = config.defaultBaseUrl;
		this._configSection = config.configSection;
		this._apiKeyPrompt = config.apiKeyPrompt ?? `Enter your ${config.providerName} API Key`;
		this._apiKeyPlaceholder = config.apiKeyPlaceholder ?? 'your-api-key-here';
		this._createClient = config.createClient;
		this._lowerId = this.toLowerCaseFirstChar(config.providerId);

		this.config = {
			vendorId: config.providerId,
			vendorName: config.providerName,
			baseUrl: config.defaultBaseUrl,
			apiKeyConfigKey: `${config.configSection}.${this._lowerId}ApiKey`,
			apiKeySecretKey: `${config.configSection}.${this._lowerId}.apiKey`,
			modelIdOverridesConfigKey: `${config.configSection}.modelIdOverrides`,
		};

		logger.provider.info(`[${this.id}] BaseModelProvider created`);
	}

	private toLowerCaseFirstChar(str: string): string {
		return str.charAt(0).toLowerCase() + str.slice(1);
	}

	getApiKey(): Promise<string | undefined> {
		return Promise.resolve(this._context.secrets.get(this.config.apiKeySecretKey));
	}

	async hasApiKey(): Promise<boolean> {
		const key = await this.getApiKey();
		return key !== undefined && key.length > 0;
	}

	async promptForApiKey(): Promise<boolean> {
		logger.auth.info(`[${this.id}] Prompting for API key...`);
		const apiKey = await vscode.window.showInputBox({
			title: this._apiKeyPrompt,
			password: true,
			ignoreFocusOut: true,
			placeHolder: this._apiKeyPlaceholder,
			prompt: this._apiKeyPrompt,
		});

		if (apiKey === undefined) {
			logger.auth.info(`[${this.id}] API key input cancelled`);
			return false;
		}

		if (apiKey.trim().length === 0) {
			vscode.window.showWarningMessage('API key cannot be empty');
			return false;
		}

		await this._context.secrets.store(this.config.apiKeySecretKey, apiKey.trim());
		logger.auth.info(`[${this.id}] API key saved successfully`);
		return true;
	}

	deleteApiKey(): Promise<void> {
		return Promise.resolve(this._context.secrets.delete(this.config.apiKeySecretKey));
	}

	getModels(): ModelDefinition[] {
		logger.provider.debug(`[${this.id}] Returning ${this._models.length} models`);
		return this._models;
	}

	createClient(apiKey: string): IApiClient {
		const baseUrl = this.getBaseUrl();
		logger.provider.debug(`[${this.id}] Creating client, baseUrl: ${baseUrl}`);
		return this._createClient(baseUrl, apiKey);
	}

	getBaseUrl(): string {
		const config = vscode.workspace.getConfiguration(this._configSection);
		const baseUrl = config.get<string>(`${this.toLowerCaseFirstChar(this.id)}BaseUrl`) || this._defaultBaseUrl;
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
