/**
 * Model Router - Route requests across multiple providers with failover and latency tracking
 *
 * Core responsibilities:
 * - Aggregate model lists from all providers, expose unified interface
 * - Dispatch requests to corresponding provider by model ID
 * - Support failover: automatically switch to fallback provider on failure
 * - Support latency-aware routing: select provider with lowest historical latency
 */

import vscode from "vscode";
import { IChatProvider } from "./chat-provider";
import { ProviderModels } from "./provider-models";
import { logger } from "./logger";
import {
  NetworkError,
  RateLimitError,
  ServiceUnavailableError,
  TimeoutError,
} from "./errors";
import { CONFIG_SECTION } from "./models";

/** Routing strategy */
export type RoutingStrategy = "failover" | "latency";

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
    if (!list || list.length === 0) {
      return undefined;
    }

    const successful = list.filter((r) => r.success);
    if (successful.length === 0) {
      return undefined;
    }

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
      if (stats) {
        result.set(providerId, stats);
      }
    }
    return result;
  }

  /** Clear all records */
  clear(): void {
    this.records.clear();
  }
}

export class ModelRouter implements IChatProvider {
  private static readonly FAILOVER_CACHE_TTL = 30_000;

  private providers = new Map<string, IChatProvider>();
  private modelToPrimaryProvider = new Map<string, string>();
  private providerModels = new Map<string, string[]>();
  private providerEventDisposables = new Map<string, vscode.Disposable>();
  readonly latencyTracker = new LatencyTracker();

  private failoverModelsCache: Record<string, string> | null = null;
  private failoverModelsCacheTime = 0;
  private routingStrategyCache: RoutingStrategy | null = null;
  private routingStrategyCacheTime = 0;

  private readonly onDidChangeEmitter = new vscode.EventEmitter<void>();
  readonly onDidChangeLanguageModelChatInformation =
    this.onDidChangeEmitter.event;

  /** Register a provider and its hosted model list */
  addProvider(
    providerId: string,
    provider: IChatProvider,
    models: string[],
  ): void {
    this.providers.set(providerId, provider);
    this.providerModels.set(providerId, models);

    for (const modelId of models) {
      if (!this.modelToPrimaryProvider.has(modelId)) {
        this.modelToPrimaryProvider.set(modelId, providerId);
      }
    }

    if (provider.onDidChangeLanguageModelChatInformation) {
      const disposable = provider.onDidChangeLanguageModelChatInformation(
        () => {
          this.onDidChangeEmitter.fire();
        },
      );
      this.providerEventDisposables.set(providerId, disposable);
    }
  }

  /** Remove a provider and dispose its resources */
  removeProvider(providerId: string): void {
    const provider = this.providers.get(providerId);
    this.providers.delete(providerId);
    this.providerModels.delete(providerId);
    this.providerEventDisposables.get(providerId)?.dispose();
    this.providerEventDisposables.delete(providerId);
    for (const [modelId, pid] of this.modelToPrimaryProvider) {
      if (pid === providerId) {
        this.modelToPrimaryProvider.delete(modelId);
      }
    }
    provider?.dispose();
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
  private findProviderForModel(
    modelId: string,
  ): { provider: IChatProvider; providerId: string } | undefined {
    const providerId = this.modelToPrimaryProvider.get(modelId);
    if (!providerId) {
      return undefined;
    }
    const provider = this.providers.get(providerId);
    if (!provider) {
      return undefined;
    }
    return { provider, providerId };
  }

  /** Find fallback provider for failover */
  private findFallbackProvider(
    failedModelId: string,
    triedProviderIds: Set<string>,
  ): { provider: IChatProvider; providerId: string } | undefined {
    const failoverModels = this.getFailoverModels();
    const fallbackModelId = failoverModels[failedModelId];
    if (!fallbackModelId) {
      return undefined;
    }

    const fallbackModelProvider =
      ProviderModels.getInstance().findProviderByModelId(fallbackModelId);
    if (
      !fallbackModelProvider ||
      triedProviderIds.has(fallbackModelProvider.id)
    ) {
      return undefined;
    }

    const provider = this.providers.get(fallbackModelProvider.id);
    if (!provider) {
      return undefined;
    }

    return { provider, providerId: fallbackModelProvider.id };
  }

  /**
   * Latency-aware routing selection
   * Among candidate providers, select the one with lowest historical latency
   */
  private selectLowestLatencyProvider(
    providerIds: string[],
  ): string | undefined {
    let best: string | undefined;
    let bestLatency = Infinity;

    for (const pid of providerIds) {
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
        const result = await provider.provideLanguageModelChatInformation(
          options,
          token,
        );
        if (result) {
          allInfos.push(...result);
        }
      } catch (error) {
        logger.router.error(
          `Error getting model info from "${providerId}"`,
          error,
        );
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

    const found = this.findProviderForModel(modelId);
    if (!found) {
      throw new Error(`[Router] No provider found for model "${modelId}"`);
    }

    let primaryProvider = found.provider;
    let activeProviderId = found.providerId;

    const strategy = this.getRoutingStrategy();
    if (strategy === "latency") {
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
      logger.router.info(
        `Routing to "${activeProviderId}" for model "${modelId}"`,
      );
      await primaryProvider.provideLanguageModelChatResponse(
        modelInfo,
        messages,
        options,
        progress,
        token,
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

      if (this.isTransientError(error)) {
        const triedProviders = new Set<string>([activeProviderId]);
        let lastError = error;

        // Multi-level failover: keep trying fallback providers until one succeeds or none remain
        while (true) {
          const fallback = this.findFallbackProvider(modelId, triedProviders);
          if (!fallback) {
            break;
          }

          const { provider: fallbackProvider, providerId: fallbackPid } =
            fallback;
          triedProviders.add(fallbackPid);

          logger.router.warn(
            `Failover to "${fallbackPid}" for model "${modelId}" after error: ${lastError instanceof Error ? lastError.message : String(lastError)}`,
          );

          const fallbackStart = Date.now();
          try {
            await fallbackProvider.provideLanguageModelChatResponse(
              modelInfo,
              messages,
              options,
              progress,
              token,
            );
            this.latencyTracker.record({
              providerId: fallbackPid,
              modelId,
              duration: Date.now() - fallbackStart,
              success: true,
              timestamp: Date.now(),
            });
            return;
          } catch (fallbackError) {
            this.latencyTracker.record({
              providerId: fallbackPid,
              modelId,
              duration: Date.now() - fallbackStart,
              success: false,
              timestamp: Date.now(),
            });

            if (!this.isTransientError(fallbackError)) {
              throw fallbackError;
            }
            lastError = fallbackError;
          }
        }

        throw lastError;
      }

      throw error;
    }
  }

  async provideTokenCount(
    modelInfo: vscode.LanguageModelChatInformation,
    text: string | vscode.LanguageModelChatRequestMessage,
    token: vscode.CancellationToken,
  ): Promise<number> {
    const found = this.findProviderForModel(modelInfo.id);
    if (!found) {
      return 0;
    }
    return found.provider.provideTokenCount(modelInfo, text, token);
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
    for (const disposable of this.providerEventDisposables.values()) {
      disposable.dispose();
    }
    this.providerEventDisposables.clear();

    for (const provider of this.providers.values()) {
      provider.dispose();
    }
    this.providers.clear();
    this.modelToPrimaryProvider.clear();
    this.providerModels.clear();
    this.latencyTracker.clear();
    this.onDidChangeEmitter.dispose();
  }

  // ── Routing Strategy & Config ────────────────────

  private getFailoverModels(): Record<string, string> {
    if (
      this.failoverModelsCache !== null &&
      Date.now() - this.failoverModelsCacheTime < ModelRouter.FAILOVER_CACHE_TTL
    ) {
      return this.failoverModelsCache;
    }
    try {
      const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
      this.failoverModelsCache = config.get<Record<string, string>>(
        "failoverModels",
        {},
      );
      this.failoverModelsCacheTime = Date.now();
      return this.failoverModelsCache;
    } catch {
      return {};
    }
  }

  private getRoutingStrategy(): RoutingStrategy {
    if (
      this.routingStrategyCache !== null &&
      Date.now() - this.routingStrategyCacheTime <
        ModelRouter.FAILOVER_CACHE_TTL
    ) {
      return this.routingStrategyCache;
    }
    try {
      const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
      this.routingStrategyCache = config.get<RoutingStrategy>(
        "routingStrategy",
        "failover",
      );
      this.routingStrategyCacheTime = Date.now();
      return this.routingStrategyCache;
    } catch {
      return "failover";
    }
  }

  private isTransientError(error: unknown): boolean {
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
        msg.includes("timeout") ||
        msg.includes("network") ||
        msg.includes("econnrefused") ||
        msg.includes("econnreset") ||
        msg.includes("503") ||
        msg.includes("502") ||
        msg.includes("429") ||
        msg.includes("rate limit") ||
        msg.includes("service unavailable") ||
        msg.includes("too many requests")
      );
    }
    return false;
  }
}
