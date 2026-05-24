/**
 * Registry - Combined provider factory registry and model registry
 */

import vscode from 'vscode';
import type { IChatProvider } from './chat-provider';
import type { ModelDefinition } from './models';
import { logger } from './lib/logger';
import { IModelProvider } from './model-provider';

// ── Provider Factory ────────────────────────────────────

/**
 * Provider factory interface
 * All model providers must implement this interface for dynamic registration
 */
export interface IProviderFactory {
  readonly providerId: string;
  readonly providerName: string;
  isEnabled(): boolean;
  createChatProvider(context: vscode.ExtensionContext): IChatProvider;
}

/**
 * ProviderFactory configuration
 */
export interface ProviderFactoryConfig {
  providerId: string;
  providerName: string;
  configSection: string;
  enabledByDefault?: boolean;
  createChatProvider: (context: vscode.ExtensionContext) => IChatProvider;
}

/**
 * Helper function to create ProviderFactory
 */
export function createProviderFactory(config: ProviderFactoryConfig): IProviderFactory {
  const { providerId, providerName, configSection, enabledByDefault = true, createChatProvider } = config;

  return {
    providerId,
    providerName,
    isEnabled: () => {
      const cfg = vscode.workspace.getConfiguration(configSection);
      return cfg.get<boolean>(`${providerId}.enabled`, enabledByDefault);
    },
    createChatProvider,
  };
}

/**
 * Helper function to create ProviderFactory registration function
 */
export function createProviderFactoryRegister(config: ProviderFactoryConfig) {
  const factory = createProviderFactory(config);

  return {
    factory,
    register: () => {
      Registry.getInstance().registerFactory(factory);
    },
  };
}

/**
 * Provider registration decorator - for auto-registering provider factories
 */
export function registerProvider(providerId: string, providerName: string) {
  return function <
    T extends new (context: import('vscode').ExtensionContext) => ReturnType<IProviderFactory['createChatProvider']>,
  >(target: T, _context: ClassFieldDecoratorContext): T {
    const factory: IProviderFactory = {
      providerId,
      providerName,
      isEnabled: () => true,
      createChatProvider: (context: import('vscode').ExtensionContext) => new target(context),
    };

    if (process.env.NODE_ENV !== 'test') {
      queueMicrotask(() => {
        Registry.getInstance().registerFactory(factory);
      });
    }

    return target;
  };
}

// ── Registry ────────────────────────────────────────────

/**
 * Global registry - manages provider factories and model providers
 */
export class Registry {
  private static instance: Registry | undefined;

  // Factory storage (from ProviderFactoryRegistry)
  private factories: Map<string, IProviderFactory> = new Map();

  // Provider storage (from ModelRegistry)
  private providers: Map<string, IModelProvider> = new Map();
  private models: Map<string, ModelDefinition[]> = new Map();

  private constructor() {
    logger.registry.debug('Registry initialized');
  }

  static getInstance(): Registry {
    if (!Registry.instance) {
      Registry.instance = new Registry();
    }
    return Registry.instance;
  }

  static _resetInstance(): void {
    if (Registry.instance) {
      Registry.instance.clear();
      Registry.instance = undefined;
      logger.registry.debug('Registry instance reset');
    }
  }

  static _isInitialized(): boolean {
    return Registry.instance !== undefined;
  }

  // ── Factory Methods ──

  registerFactory(factory: IProviderFactory): void {
    if (this.factories.has(factory.providerId)) {
      logger.provider.debug(`Provider factory "${factory.providerId}" is already registered, skipping`);
      return;
    }
    this.factories.set(factory.providerId, factory);
    logger.provider.debug(`Registered provider factory: ${factory.providerId}`);
  }

  getFactory(providerId: string): IProviderFactory | undefined {
    return this.factories.get(providerId);
  }

  getEnabledFactories(): IProviderFactory[] {
    return Array.from(this.factories.values()).filter((f) => f.isEnabled());
  }

  getAllFactories(): IProviderFactory[] {
    return Array.from(this.factories.values());
  }

  hasFactory(providerId: string): boolean {
    return this.factories.has(providerId);
  }

  get factoryCount(): number {
    return this.factories.size;
  }

  // ── Provider Methods ──

  registerProvider(provider: IModelProvider): void {
    if (this.providers.has(provider.id)) {
      logger.registry.warn(`Provider "${provider.id}" is already registered, skipping`);
      return;
    }
    const models = provider.getModels();
    this.providers.set(provider.id, provider);
    this.models.set(provider.id, models);
    logger.registry.debug(`Registered provider: ${provider.id} with ${models.length} models`);

    for (const model of models) {
      logger.registry.debug(`  - Model: ${model.id} (${model.family})`);
    }
  }

  unregisterProvider(providerId: string): void {
    if (this.providers.delete(providerId)) {
      this.models.delete(providerId);
      logger.registry.debug(`Unregistered provider: ${providerId}`);
    } else {
      logger.registry.warn(`Provider "${providerId}" not found, cannot unregister`);
    }
  }

  getProvider(providerId: string): IModelProvider | undefined {
    const provider = this.providers.get(providerId);
    if (!provider) {
      logger.registry.debug(`Provider "${providerId}" not found`);
    }
    return provider;
  }

  getAllProviders(): IModelProvider[] {
    const providers = Array.from(this.providers.values());
    logger.registry.debug(`Getting all providers, count: ${providers.length}`);
    return providers;
  }

  getModelsForProvider(providerId: string): ModelDefinition[] {
    const models = this.models.get(providerId) || [];
    logger.registry.debug(`Getting models for provider "${providerId}", count: ${models.length}`);
    return models;
  }

  getAllModels(): ModelDefinition[] {
    const allModels: ModelDefinition[] = [];
    for (const models of this.models.values()) {
      allModels.push(...models);
    }
    logger.registry.debug(`Getting all models, total count: ${allModels.length}`);
    return allModels;
  }

  findModelById(modelId: string): ModelDefinition | undefined {
    for (const models of this.models.values()) {
      const found = models.find((m) => m.id === modelId);
      if (found) {
        logger.registry.debug(`Found model by id "${modelId}": ${found.name}`);
        return found;
      }
    }
    logger.registry.debug(`Model not found by id "${modelId}"`);
    return undefined;
  }

  findProviderByModelId(modelId: string): IModelProvider | undefined {
    for (const [providerId, models] of this.models.entries()) {
      if (models.some((m) => m.id === modelId)) {
        const provider = this.providers.get(providerId);
        logger.registry.debug(`Found provider "${providerId}" for model "${modelId}"`);
        return provider;
      }
    }
    logger.registry.debug(`Provider not found for model "${modelId}"`);
    return undefined;
  }

  hasProviders(): boolean {
    return this.providers.size > 0;
  }

  clear(): void {
    this.factories.clear();
    this.providers.clear();
    this.models.clear();
    logger.registry.debug(`Cleared all registrations`);
  }
}
