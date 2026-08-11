import vscode from "vscode";
import {
  CONFIG_SECTION,
  type ModelDefinition,
  type ProviderDefinition,
} from "./models";
import { logger } from "./logger";
import { BaseChatProvider, type ThinkingEffort } from "./chat-provider";
import { BaseModelProvider } from "./model-provider";
import { createApiClient, type ApiRequest } from "./client";
import { createSingletonStore } from "./singleton";
import type { IChatProvider } from "./chat-provider";
import type { IModelProvider } from "./model-provider";

// ── Provider Factory ────────────────────────────────────

export interface IProviderFactory {
  readonly providerId: string;
  readonly providerName: string;
  isEnabled(): boolean;
  createChatProvider(context: vscode.ExtensionContext): IChatProvider;
}

export interface ProviderFactoryConfig {
  providerId: string;
  providerName: string;
  configSection: string;
  enabledByDefault?: boolean;
  createChatProvider: (context: vscode.ExtensionContext) => IChatProvider;
}

export function createProviderFactory(
  config: ProviderFactoryConfig,
): IProviderFactory {
  const {
    providerId,
    providerName,
    configSection,
    enabledByDefault = true,
    createChatProvider,
  } = config;

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

// ── ProviderModels Class ────────────────────────────

export class ProviderModels {
  private static store = createSingletonStore<ProviderModels>();

  private readonly definitions: ProviderDefinition[];

  private factories = new Map<string, IProviderFactory>();
  private providers = new Map<string, IModelProvider>();
  private models = new Map<string, ModelDefinition[]>();
  private modelIdToProviderId = new Map<string, string>();

  private constructor(definitions: ProviderDefinition[]) {
    this.definitions = definitions;
  }

  static init(definitions: ProviderDefinition[]): ProviderModels {
    const instance = new ProviderModels(definitions);
    ProviderModels.store.set(instance);
    return instance;
  }

  static getInstance(): ProviderModels {
    return ProviderModels.store.get();
  }

  static resetInstance(): void {
    const inst = ProviderModels.store.getOptional();
    inst?.clear();
    ProviderModels.store.reset();
  }

  static isInitialized(): boolean {
    return ProviderModels.store.getOptional() !== undefined;
  }

  // ── Definitions ──────────────────────────────────

  getDefinitions(): ProviderDefinition[] {
    return this.definitions;
  }

  // ── Factory Management ───────────────────────────

  registerFactory(factory: IProviderFactory): void {
    if (this.factories.has(factory.providerId)) {
      logger.provider.debug(
        `Provider factory "${factory.providerId}" is already registered, skipping`,
      );
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

  // ── Provider Management ──────────────────────────

  registerProvider(provider: IModelProvider): void {
    if (this.providers.has(provider.id)) {
      logger.registry.warn(
        `Provider "${provider.id}" is already registered, skipping`,
      );
      return;
    }
    const providerModels = provider.getModels();
    this.providers.set(provider.id, provider);
    this.models.set(provider.id, providerModels);
    for (const model of providerModels) {
      if (!this.modelIdToProviderId.has(model.id)) {
        this.modelIdToProviderId.set(model.id, provider.id);
      }
    }
    logger.registry.debug(
      `Registered provider: ${provider.id} with ${providerModels.length} models: [${providerModels.map((m) => m.id).join(", ")}]`,
    );
  }

  unregisterProvider(providerId: string): void {
    if (this.providers.delete(providerId)) {
      this.models.delete(providerId);
      for (const [modelId, pid] of this.modelIdToProviderId) {
        if (pid === providerId) {
          this.modelIdToProviderId.delete(modelId);
        }
      }
      logger.registry.debug(`Unregistered provider: ${providerId}`);
    } else {
      logger.registry.warn(
        `Provider "${providerId}" not found, cannot unregister`,
      );
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
    return Array.from(this.providers.values());
  }

  getModelsForProvider(providerId: string): ModelDefinition[] {
    return this.models.get(providerId) || [];
  }

  getAllModels(): ModelDefinition[] {
    const allModels: ModelDefinition[] = [];
    for (const models of this.models.values()) {
      allModels.push(...models);
    }
    return allModels;
  }

  findModelById(modelId: string): ModelDefinition | undefined {
    for (const models of this.models.values()) {
      const found = models.find((m) => m.id === modelId);
      if (found) {
        return found;
      }
    }
    return undefined;
  }

  findProviderByModelId(modelId: string): IModelProvider | undefined {
    const providerId = this.modelIdToProviderId.get(modelId);
    if (providerId) {
      return this.providers.get(providerId);
    }
    return undefined;
  }

  hasProviders(): boolean {
    return this.providers.size > 0;
  }

  clear(): void {
    this.factories.clear();
    this.providers.clear();
    this.models.clear();
    this.modelIdToProviderId.clear();
  }

  // ── Registration ─────────────────────────────────

  registerAll(): IProviderFactory[] {
    const factories: IProviderFactory[] = [];

    for (const def of this.definitions) {
      const factory = this.createFactory(def);
      this.registerFactory(factory);
      factories.push(factory);
      logger.provider.debug(`Registered provider: ${def.name} (${def.id})`);
    }

    logger.provider.info(
      `Registered ${factories.length} provider(s): ${factories.map((f) => f.providerId).join(", ")}`,
    );
    return factories;
  }

  // ── Private ──────────────────────────────────────

  private createFactory(def: ProviderDefinition): IProviderFactory {
    const thinkingFormat = def.thinkingFormat ?? "reasoning_effort";
    const supportsThinking = def.supportsThinking ?? false;

    return createProviderFactory({
      providerId: def.id,
      providerName: def.name,
      configSection: CONFIG_SECTION,
      createChatProvider: (ctx: vscode.ExtensionContext) => {
        const modelProvider = new BaseModelProvider(
          ctx,
          def,
          (baseUrl, apiKey, options) =>
            createApiClient({
              baseUrl,
              apiKey,
              providerName: def.name,
              timeoutMs: options?.timeoutMs ?? 60_000,
              maxRetries: options?.maxRetries ?? 1,
            }),
        );
        ProviderModels.getInstance().registerProvider(modelProvider);
        return new GenericChatProvider(
          ctx,
          modelProvider,
          thinkingFormat,
          supportsThinking,
        );
      },
    });
  }
}

// ── Generic Chat Provider ──────────────────────────

class GenericChatProvider extends BaseChatProvider {
  private readonly thinkingFormat: "reasoning_effort" | "thinking_type";
  private readonly _supportsThinking: boolean;

  constructor(
    context: vscode.ExtensionContext,
    modelProvider: IModelProvider,
    thinkingFormat: "reasoning_effort" | "thinking_type",
    supportsThinking: boolean,
  ) {
    super(context, modelProvider);
    this.thinkingFormat = thinkingFormat;
    this._supportsThinking = supportsThinking;
  }

  protected override getSupportsThinking(): boolean {
    return this._supportsThinking;
  }

  protected override convertThinkingParams(
    request: ApiRequest,
    effort: ThinkingEffort,
  ): void {
    if (this.thinkingFormat === "thinking_type") {
      request.thinking = { type: effort === "none" ? "disabled" : "enabled" };
    } else {
      if (effort !== "none") {
        request.reasoning_effort = effort;
      }
    }
  }
}
