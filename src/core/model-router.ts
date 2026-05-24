/**
 * Model Router - Route requests across multiple providers with failover and latency tracking
 *
 * Core responsibilities:
 * - Aggregate model lists from all providers, expose unified interface
 * - Dispatch requests to corresponding provider by model ID
 * - Support failover: automatically switch to fallback provider on failure
 * - Support latency-aware routing: select provider with lowest historical latency
 */

import vscode from 'vscode';
import { IChatProvider } from './chat-provider';
import { Registry } from './registry';
import { logger } from './logger';
import { NetworkError, RateLimitError, ServiceUnavailableError, TimeoutError } from './client';

/** Routing strategy */
export type RoutingStrategy = 'failover' | 'latency';

/** Single request latency record */
export interface LatencyRecord {
  providerId: string;
  modelId: string;
  duration: number;
  success: boolean;
  timestamp: number;
}

/** Latency statistics (sliding window) */
export interface LatencyStats {
  averageMs: number;
  minMs: number;
  maxMs: number;
  count: number;
  lastRecorded: number;
}

const SLIDING_WINDOW_SIZE = 50;
const CONFIG_SECTION = 'copilot-models';

/**
 * Latency Tracker
 * Maintains sliding window latency records per provider for latency-aware routing
 */
export class LatencyTracker {
  private records: Map<string, LatencyRecord[]> = new Map();

  /** Record latency data for a request */
  record(entry: LatencyRecord): void {
    let list = this.records.get(entry.providerId);
    if (!list) {
      list = [];
      this.records.set(entry.providerId, list);
    }
    list.push(entry);
    if (list.length > SLIDING_WINDOW_SIZE) {
      list.shift();
    }
  }

  /** Get latency stats for a provider (successful requests only) */
  getStats(providerId: string): LatencyStats | undefined {
    const list = this.records.get(providerId);
    if (!list || list.length === 0) {return undefined;}

    const successful = list.filter((r) => r.success);
    if (successful.length === 0) {return undefined;}

    const durations = successful.map((r) => r.duration);
    const sum = durations.reduce((a, b) => a + b, 0);
    return {
      averageMs: sum / durations.length,
      minMs: Math.min(...durations),
      maxMs: Math.max(...durations),
      count: successful.length,
      lastRecorded: successful[successful.length - 1].timestamp,
    };
  }

  /** Get latency stats for all providers */
  getAllStats(): Map<string, LatencyStats> {
    const result = new Map<string, LatencyStats>();
    for (const providerId of this.records.keys()) {
      const stats = this.getStats(providerId);
      if (stats) {result.set(providerId, stats);}
    }
    return result;
  }

  /** Clear all records */
  clear(): void {
    this.records.clear();
  }
}

let failoverModelsCache: Record<string, string> | null = null;
let failoverModelsCacheTime = 0;
const FAILOVER_CACHE_TTL = 30_000;

function getFailoverModels(): Record<string, string> {
  if (failoverModelsCache !== null && Date.now() - failoverModelsCacheTime < FAILOVER_CACHE_TTL) {
    return failoverModelsCache;
  }
  try {
    const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
    failoverModelsCache = config.get<Record<string, string>>('failoverModels', {});
    failoverModelsCacheTime = Date.now();
    return failoverModelsCache;
  } catch {
    return {};
  }
}

/** Read routing strategy from config */
function getRoutingStrategy(): RoutingStrategy {
  try {
    const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
    return config.get<RoutingStrategy>('routingStrategy', 'failover');
  } catch {
    return 'failover';
  }
}

/**
 * Check if error is a transient error suitable for failover
 * Timeouts, network errors, rate limits, etc.
 */
function isTransientError(error: unknown): boolean {
  if (
    error instanceof RateLimitError ||
    error instanceof ServiceUnavailableError ||
    error instanceof NetworkError ||
    error instanceof TimeoutError
  ) {
    return true;
  }

  if (error instanceof Error) {
    const msg = error.message.toLowerCase();
    return (
      msg.includes('timeout') ||
      msg.includes('network') ||
      msg.includes('econnrefused') ||
      msg.includes('econnreset') ||
      msg.includes('503') ||
      msg.includes('502') ||
      msg.includes('429') ||
      msg.includes('rate limit') ||
      msg.includes('service unavailable') ||
      msg.includes('too many requests') ||
      msg.includes('not configured') ||
      msg.includes('api key')
    );
  }
  return false;
}

export class ModelRouter implements IChatProvider {
  private providers = new Map<string, IChatProvider>();
  private modelToPrimaryProvider = new Map<string, string>();
  private providerModels = new Map<string, string[]>();
  readonly latencyTracker = new LatencyTracker();

  private readonly onDidChangeEmitter = new vscode.EventEmitter<void>();
  readonly onDidChangeLanguageModelChatInformation = this.onDidChangeEmitter.event;

  /** Register a provider and its hosted model list */
  addProvider(providerId: string, provider: IChatProvider, models: string[]): void {
    this.providers.set(providerId, provider);
    this.providerModels.set(providerId, models);

    for (const modelId of models) {
      if (!this.modelToPrimaryProvider.has(modelId)) {
        this.modelToPrimaryProvider.set(modelId, providerId);
      }
    }

    if (provider.onDidChangeLanguageModelChatInformation) {
      provider.onDidChangeLanguageModelChatInformation(() => {
        this.onDidChangeEmitter.fire();
      });
    }
  }

  /** Remove a provider */
  removeProvider(providerId: string): void {
    this.providers.delete(providerId);
    this.providerModels.delete(providerId);
    for (const [modelId, pid] of this.modelToPrimaryProvider) {
      if (pid === providerId) {
        this.modelToPrimaryProvider.delete(modelId);
      }
    }
  }

  /** Get all registered provider IDs */
  getProviderIds(): string[] {
    return Array.from(this.providers.keys());
  }

  /** Check if a provider is registered */
  hasProvider(providerId: string): boolean {
    return this.providers.has(providerId);
  }

  /** Find provider by model ID */
  private findProviderForModel(modelId: string): IChatProvider | undefined {
    const pid = this.modelToPrimaryProvider.get(modelId);
    if (pid) {return this.providers.get(pid);}
    return undefined;
  }

  /** Find fallback provider for failover */
  private findFallbackProvider(failedModelId: string, failedProviderId: string): IChatProvider | undefined {
    const failoverModels = getFailoverModels();
    const fallbackModelId = failoverModels[failedModelId];
    if (!fallbackModelId) {return undefined;}

    const registry = Registry.getInstance();
    const fallbackProvider = registry.findProviderByModelId(fallbackModelId);
    if (!fallbackProvider || fallbackProvider.id === failedProviderId) {return undefined;}

    return this.providers.get(fallbackProvider.id);
  }

  /**
   * Latency-aware routing selection
   * Among providers that can serve the same model, select the one with lowest historical latency
   */
  private selectLowestLatencyProvider(models: string[]): string | undefined {
    const strategy = getRoutingStrategy();
    if (strategy !== 'latency') {return undefined;}

    let best: string | undefined;
    let bestLatency = Infinity;

    for (const modelId of models) {
      const pid = this.modelToPrimaryProvider.get(modelId);
      if (!pid) {continue;}

      const stats = this.latencyTracker.getStats(pid);
      const latency = stats?.averageMs ?? Infinity;
      if (latency < bestLatency) {
        bestLatency = latency;
        best = pid;
      }
    }

    return best;
  }

  async provideLanguageModelChatInformation(
    options: vscode.PrepareLanguageModelChatModelOptions,
    token: vscode.CancellationToken,
  ): Promise<vscode.LanguageModelChatInformation[]> {
    const allInfos: vscode.LanguageModelChatInformation[] = [];

    for (const [providerId, provider] of this.providers) {
      try {
        const result = await provider.provideLanguageModelChatInformation(options, token);
        if (result) {
          allInfos.push(...result);
        }
      } catch (error) {
        logger.router.error(`Error getting model info from "${providerId}"`, error);
      }
    }

    return allInfos;
  }

  async provideLanguageModelChatResponse(
    modelInfo: vscode.LanguageModelChatInformation,
    messages: readonly vscode.LanguageModelChatRequestMessage[],
    options: vscode.ProvideLanguageModelChatResponseOptions,
    progress: vscode.Progress<vscode.LanguageModelResponsePart>,
    token: vscode.CancellationToken,
  ): Promise<void> {
    const modelId = modelInfo.id;
    const startTime = Date.now();

    let primaryProvider = this.findProviderForModel(modelId);

    if (!primaryProvider) {
      throw new Error(`[Router] No provider found for model "${modelId}"`);
    }

    let activeProviderId = this.getProviderIdForModel(modelId);

    const strategy = getRoutingStrategy();
    if (strategy === 'latency') {
      const candidatePids = Array.from(this.providerModels.entries())
        .filter(([_, models]) => models.includes(modelId))
        .map(([pid]) => pid);

      const best = this.selectLowestLatencyProvider(candidatePids);
      if (best) {
        const bestProvider = this.providers.get(best);
        if (bestProvider) {
          primaryProvider = bestProvider;
          activeProviderId = best;
        }
      }
    }

    try {
      logger.router.info(`Routing to "${activeProviderId}" for model "${modelId}"`);
      await primaryProvider.provideLanguageModelChatResponse(
        modelInfo, messages, options, progress, token,
      );
      this.latencyTracker.record({
        providerId: activeProviderId,
        modelId,
        duration: Date.now() - startTime,
        success: true,
        timestamp: Date.now(),
      });
    } catch (error) {
      this.latencyTracker.record({
        providerId: activeProviderId,
        modelId,
        duration: Date.now() - startTime,
        success: false,
        timestamp: Date.now(),
      });

      if (isTransientError(error)) {
        const fallback = this.findFallbackProvider(modelId, activeProviderId);
        if (fallback) {
          const fallbackPid = this.getProviderIdForModel(modelId);
          logger.router.warn(`Failover to "${fallbackPid}" for model "${modelId}" after error: ${error instanceof Error ? error.message : String(error)}`);
          const fallbackStart = Date.now();
          await fallback.provideLanguageModelChatResponse(
            modelInfo, messages, options, progress, token,
          );
          this.latencyTracker.record({
            providerId: fallbackPid,
            modelId,
            duration: Date.now() - fallbackStart,
            success: true,
            timestamp: Date.now(),
          });
          return;
        }
      }

      throw error;
    }
  }

  async provideTokenCount(
    modelInfo: vscode.LanguageModelChatInformation,
    text: string | vscode.LanguageModelChatRequestMessage,
    token: vscode.CancellationToken,
  ): Promise<number> {
    const provider = this.findProviderForModel(modelInfo.id);
    if (!provider) {return 0;}
    return provider.provideTokenCount(modelInfo, text, token);
  }

  refreshModelPicker(): void {
    for (const provider of this.providers.values()) {
      provider.refreshModelPicker();
    }
  }

  async prepareForDeactivate(): Promise<void> {
    for (const provider of this.providers.values()) {
      await provider.prepareForDeactivate();
    }
  }

  dispose(): void {
    for (const provider of this.providers.values()) {
      provider.dispose();
    }
    this.providers.clear();
    this.modelToPrimaryProvider.clear();
    this.providerModels.clear();
    this.latencyTracker.clear();
    this.onDidChangeEmitter.dispose();
  }

  async configureApiKey(): Promise<void> {
    const providerIds = Array.from(this.providers.keys());
    if (providerIds.length === 0) {return;}
    if (providerIds.length === 1) {
      await this.providers.get(providerIds[0])!.configureApiKey();
      return;
    }

    const selected = await vscode.window.showQuickPick(
      providerIds.map((id) => ({ label: id, id })),
      { placeHolder: 'Select a provider to configure API key' },
    );
    if (selected) {
      await this.providers.get(selected.id)!.configureApiKey();
    }
  }

  async clearApiKey(): Promise<void> {
    for (const provider of this.providers.values()) {
      await provider.clearApiKey();
    }
  }

  private getProviderIdForModel(modelId: string): string {
    return this.modelToPrimaryProvider.get(modelId) || 'unknown';
  }
}
