/**
 * Base Model Provider - Generic model provider implementation
 */

import vscode from 'vscode';
import type { ModelDefinition } from './models';
import { logger } from './logger';
import { BaseAuthManager } from './auth-manager';
import { ClientOptions, IApiClient } from './client';

/**
 * Model provider configuration
 */
export interface ProviderConfig {
	/** Provider ID (vendor name) */
	vendorId: string;
	/** Provider display name */
	vendorName: string;
	/** API base URL */
	baseUrl: string;
	/** SecretStorage key name */
	apiKeySecretKey: string;
}


/**
 * Model provider interface
 */
export interface IModelProvider {
	/** Provider configuration */
	readonly config: ProviderConfig;
	/** Provider ID */
	readonly id: string;
	/** Get API key */
	getApiKey(): Promise<string | undefined>;
	/** Check if API key is configured */
	hasApiKey(): Promise<boolean>;
	/** Prompt user for API key */
	promptForApiKey(): Promise<boolean>;
	/** Delete stored API key */
	deleteApiKey(): Promise<void>;
	/** Get model list for this provider */
	getModels(): ModelDefinition[];
	/** Get API client */
	createClient(apiKey: string, options?: ClientOptions): IApiClient;
}

/**
 * ModelProvider configuration
 */
export interface ModelProviderConfig {
	/** Provider ID */
	readonly providerId: string;
	/** Provider display name */
	readonly providerName: string;
	/** Configuration section name */
	readonly configSection: string;
	/** Default base URL */
	readonly defaultBaseUrl: string;
	/** Model list */
	readonly models: ModelDefinition[];
	/** API key prompt text */
	readonly apiKeyPrompt?: string;
	/** API key placeholder */
	readonly apiKeyPlaceholder?: string;
	/** Create API client factory function */
	createClient(baseUrl: string, apiKey: string, options?: ClientOptions): IApiClient;
}

/**
 * Base ModelProvider implementation
 * Generic model provider encapsulating common provider logic
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
