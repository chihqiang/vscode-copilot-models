/**
 * Base Model Provider - Generic model provider implementation
 */

import vscode from "vscode";
import {
  CONFIG_SECTION,
  type ModelDefinition,
  type ProviderDefinition,
} from "./models";
import {
  getMaxRetries,
  getModelIdOverrides,
  getProviderBaseUrl,
  getTimeoutMs,
} from "./settings";
import { sanitizeUrl } from "./sanitize";
import { logger } from "./logger";
import { ClientOptions, IApiClient } from "./client";

/**
 * Auth manager interface
 */
export interface IAuthManager {
  /** Get API key */
  getApiKey(): Promise<string | undefined>;
  /** Check if API key is configured */
  hasApiKey(): Promise<boolean>;
  /** Store API key */
  setApiKey(apiKey: string): Promise<void>;
  /** Delete API key */
  deleteApiKey(): Promise<void>;
}

/**
 * Base Auth Manager implementation
 * Security: API keys are stored only in VS Code SecretStorage, no plaintext fallback
 */
export class BaseAuthManager implements IAuthManager {
  protected readonly secretStorage: vscode.SecretStorage;
  protected readonly secretKey: string;
  protected readonly providerId: string;

  constructor(
    context: vscode.ExtensionContext,
    configSection: string = CONFIG_SECTION,
    providerId: string,
  ) {
    this.secretStorage = context.secrets;
    this.providerId = providerId;
    this.secretKey = `${configSection}.${providerId}.apiKey`;
    logger.auth.debug(`[${providerId}] AuthManager initialized`);
  }

  async getApiKey(): Promise<string | undefined> {
    logger.auth.debug(`[${this.providerId}] Getting API key...`);
    const apiKey = await this.secretStorage.get(this.secretKey);
    if (apiKey) {
      logger.auth.debug(`[${this.providerId}] API key found`);
      return apiKey;
    }
    logger.auth.debug(`[${this.providerId}] No API key found`);
    return undefined;
  }

  async hasApiKey(): Promise<boolean> {
    const key = await this.getApiKey();
    const has = key !== undefined && key.length > 0;
    logger.auth.debug(`[${this.providerId}] hasApiKey: ${has}`);
    return has;
  }

  async setApiKey(apiKey: string): Promise<void> {
    logger.auth.debug(`[${this.providerId}] Storing API key...`);
    await this.secretStorage.store(this.secretKey, apiKey.trim());
    logger.auth.debug(`[${this.providerId}] API key stored successfully`);
  }

  async deleteApiKey(): Promise<void> {
    logger.auth.debug(`[${this.providerId}] Deleting API key...`);
    await this.secretStorage.delete(this.secretKey);
    logger.auth.debug(`[${this.providerId}] API key deleted`);
  }

  async promptForApiKey(prompt: string, placeholder: string): Promise<boolean> {
    logger.auth.info(`[${this.providerId}] Prompting for API key...`);
    const apiKey = await vscode.window.showInputBox({
      prompt,
      placeHolder: placeholder,
      password: true,
      ignoreFocusOut: true,
      validateInput: (value: string) => {
        if (!value?.trim()) {
          return "API key cannot be empty";
        }
        return undefined;
      },
    });
    if (apiKey) {
      await this.setApiKey(apiKey);
      logger.auth.info(`[${this.providerId}] API key saved`);
      return true;
    }
    logger.auth.info(`[${this.providerId}] User cancelled API key input`);
    return false;
  }
}

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
 * API client factory signature
 */
export type CreateClientFn = (
  baseUrl: string,
  apiKey: string,
  options?: ClientOptions,
) => IApiClient;

/**
 * Base ModelProvider implementation
 * Generic model provider built directly from a ProviderDefinition
 */
export class BaseModelProvider implements IModelProvider {
  readonly config: ProviderConfig;
  readonly id: string;
  private readonly _models: ModelDefinition[];
  private readonly _defaultBaseUrl: string;
  private readonly _apiKeyPrompt: string;
  private readonly _apiKeyPlaceholder: string;
  private readonly _createClient: CreateClientFn;

  private readonly _authManager: BaseAuthManager;

  constructor(
    context: vscode.ExtensionContext,
    def: ProviderDefinition,
    createClient: CreateClientFn,
  ) {
    this.id = def.id;
    this._models = def.models;
    this._defaultBaseUrl = def.defaultBaseUrl;
    this._apiKeyPrompt = def.apiKeyPrompt ?? `Enter your ${def.name} API Key`;
    this._apiKeyPlaceholder = def.apiKeyPlaceholder ?? "your-api-key-here";
    this._createClient = createClient;
    this._authManager = new BaseAuthManager(context, CONFIG_SECTION, def.id);

    this.config = {
      vendorId: def.id,
      vendorName: def.name,
      baseUrl: def.defaultBaseUrl,
      apiKeySecretKey: `${CONFIG_SECTION}.${def.id}.apiKey`,
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
    return this._authManager.promptForApiKey(
      this._apiKeyPrompt,
      this._apiKeyPlaceholder,
    );
  }

  deleteApiKey(): Promise<void> {
    return this._authManager.deleteApiKey();
  }

  getModels(): ModelDefinition[] {
    logger.provider.debug(
      `[${this.id}] Returning ${this._models.length} models`,
    );
    return this._models;
  }

  createClient(apiKey: string, options?: ClientOptions): IApiClient {
    const baseUrl = options?.baseUrl ?? this.getBaseUrl();
    logger.provider.debug(
      `[${this.id}] Creating client, baseUrl: ${sanitizeUrl(baseUrl)}`,
    );

    const timeoutMs = options?.timeoutMs ?? getTimeoutMs();
    const maxRetries = options?.maxRetries ?? getMaxRetries();

    return this._createClient(baseUrl, apiKey, { timeoutMs, maxRetries });
  }

  getBaseUrl(): string {
    const baseUrl = getProviderBaseUrl(this.id, this._defaultBaseUrl);
    logger.provider.debug(`[${this.id}] getBaseUrl: ${sanitizeUrl(baseUrl)}`);
    return baseUrl;
  }

  getApiModelId(vscodeModelId: string): string {
    const overrides = getModelIdOverrides();
    const modelId = overrides?.[vscodeModelId]?.trim() || vscodeModelId;
    if (overrides?.[vscodeModelId]) {
      logger.provider.debug(
        `[${this.id}] Model ID override: ${vscodeModelId} -> ${modelId}`,
      );
    }
    return modelId;
  }
}
