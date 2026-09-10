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
import { estimateTokenCount, IChatProvider } from "./chat-provider";
import { ProviderModels } from "./provider-models";
import {
  generateRequestId,
  getLogContext,
  logger,
  withLogContext,
  type LogContext,
} from "./logger";
import {
  NetworkError,
  RateLimitError,
  ServiceUnavailableError,
  TimeoutError,
} from "./errors";
import { CircuitBreakerError } from "./circuit-breaker";
import { type RoutingStrategy } from "./models";
import {
  getFailoverModels as getConfiguredFailoverModels,
  getRoutingStrategy as getConfiguredRoutingStrategy,
} from "./settings";

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
 * Incrementally maintained latency aggregates for a provider's successful
 * requests, kept in sync with the sliding window of all records.
 */
interface ProviderLatencyAggregates {
  sum: number;
  min: number;
  max: number;
  count: number;
  lastRecorded: number;
  durations: number[];
}

/**
 * Latency Tracker
 * Maintains sliding window latency records per provider for latency-aware routing.
 *
 * Successful-request aggregates are updated incrementally so getStats() is O(1)
 * instead of re-filtering/reducing the whole window on every routing decision.
 */
export class LatencyTracker {
  private records = new Map<string, LatencyRecord[]>();
  private aggregates = new Map<string, ProviderLatencyAggregates>();

  /** Record latency data for a request */
  record(entry: LatencyRecord): void {
    let list = this.records.get(entry.providerId);
    if (!list) {
      list = [];
      this.records.set(entry.providerId, list);
    }
    list.push(entry);
    let evicted: LatencyRecord | undefined;
    if (list.length > SLIDING_WINDOW_SIZE) {
      evicted = list.shift();
    }

    if (entry.success) {
      this.addToAggregates(entry);
    }

    // If a successful record fell out of the window, subtract it.
    if (evicted?.success) {
      this.removeFromAggregates(evicted);
    }
  }

  /** Get latency stats for a provider (successful requests only) */
  getStats(providerId: string): LatencyStats | undefined {
    const agg = this.aggregates.get(providerId);
    if (!agg || agg.count === 0) {
      return undefined;
    }
    return {
      averageMs: agg.sum / agg.count,
      minMs: agg.min,
      maxMs: agg.max,
      count: agg.count,
      lastRecorded: agg.lastRecorded,
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
    this.aggregates.clear();
  }

  private addToAggregates(entry: LatencyRecord): void {
    let agg = this.aggregates.get(entry.providerId);
    if (!agg) {
      agg = {
        sum: 0,
        min: Infinity,
        max: -Infinity,
        count: 0,
        lastRecorded: 0,
        durations: [],
      };
      this.aggregates.set(entry.providerId, agg);
    }
    agg.durations.push(entry.duration);
    agg.sum += entry.duration;
    if (entry.duration < agg.min) {
      agg.min = entry.duration;
    }
    if (entry.duration > agg.max) {
      agg.max = entry.duration;
    }
    agg.count++;
    agg.lastRecorded = entry.timestamp;
  }

  private removeFromAggregates(entry: LatencyRecord): void {
    const agg = this.aggregates.get(entry.providerId);
    if (!agg || agg.count === 0) {
      return;
    }
    const idx = agg.durations.indexOf(entry.duration);
    if (idx === -1) {
      return;
    }
    agg.durations.splice(idx, 1);
    agg.sum -= entry.duration;
    agg.count--;

    // Recompute extremes only when the evicted value was one of them.
    if (entry.duration === agg.min || entry.duration === agg.max) {
      let newMin = Infinity;
      let newMax = -Infinity;
      for (const d of agg.durations) {
        if (d < newMin) {
          newMin = d;
        }
        if (d > newMax) {
          newMax = d;
        }
      }
      agg.min = agg.durations.length > 0 ? newMin : Infinity;
      agg.max = agg.durations.length > 0 ? newMax : -Infinity;
    }
  }
}

/**
 * Wraps a progress sink to record whether an attempt already reported output.
 *
 * Failover re-sends the whole prompt to another provider, but parts already
 * handed to `progress` cannot be retracted — they are on screen. Switching
 * providers after partial output would therefore show the beginning of the
 * response twice. The router only fails over while an attempt has produced
 * nothing.
 */
class ProgressProbe implements vscode.Progress<vscode.LanguageModelResponsePart> {
  private emitted = false;

  constructor(
    private readonly target: vscode.Progress<vscode.LanguageModelResponsePart>,
  ) {}

  /** True once any part (text, thinking, tool call) has been reported. */
  get hasEmitted(): boolean {
    return this.emitted;
  }

  report(part: vscode.LanguageModelResponsePart): void {
    this.emitted = true;
    this.target.report(part);
  }
}

export class ModelRouter implements IChatProvider {
  private static readonly FAILOVER_CACHE_TTL = 30_000;
  private static readonly MODEL_INFO_TIMEOUT_MS = 5_000;

  private providers = new Map<string, IChatProvider>();
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
    provider?.dispose();
  }

  /** Check if a provider is registered */
  hasProvider(providerId: string): boolean {
    return this.providers.has(providerId);
  }

  /** Find provider by model ID */
  private findProviderForModel(
    modelId: string,
  ): { provider: IChatProvider; providerId: string } | undefined {
    // Reuse the registry's model → provider index instead of duplicating it.
    const modelProvider =
      ProviderModels.getInstance().findProviderByModelId(modelId);
    if (!modelProvider) {
      return undefined;
    }
    const provider = this.providers.get(modelProvider.id);
    if (!provider) {
      return undefined;
    }
    return { provider, providerId: modelProvider.id };
  }

  /** Find fallback provider for failover */
  private findFallbackProvider(
    failedModelId: string,
    triedProviderIds: Set<string>,
  ):
    | { provider: IChatProvider; providerId: string; fallbackModelId: string }
    | undefined {
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

    return {
      provider,
      providerId: fallbackModelProvider.id,
      fallbackModelId,
    };
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
    const entries = Array.from(this.providers.entries());

    const results = await Promise.allSettled(
      entries.map(async ([providerId, provider]) => {
        try {
          // Guard against a slow provider stalling the aggregated model list.
          return await this.withTimeout(
            provider.provideLanguageModelChatInformation(options, token),
            ModelRouter.MODEL_INFO_TIMEOUT_MS,
            providerId,
          );
        } catch (error) {
          logger.router.error(
            `Error getting model info from "${providerId}"`,
            error,
          );
          return null;
        }
      }),
    );

    const allInfos: vscode.LanguageModelChatInformation[] = [];
    for (const result of results) {
      if (result.status === "fulfilled" && result.value) {
        allInfos.push(...result.value);
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
    // Attach a request context so every log line for this request (routing,
    // provider, client, failover) shares the same req=<id> tag.
    const existing = getLogContext();
    const ctx: LogContext = {
      requestId: existing?.requestId ?? generateRequestId(),
      modelId: modelInfo.id,
    };
    return withLogContext(ctx, () =>
      this.doProvideLanguageModelChatResponse(
        modelInfo,
        messages,
        options,
        progress,
        token,
      ),
    );
  }

  private async doProvideLanguageModelChatResponse(
    modelInfo: vscode.LanguageModelChatInformation,
    messages: readonly vscode.LanguageModelChatRequestMessage[],
    options: vscode.ProvideLanguageModelChatResponseOptions,
    progress: vscode.Progress<vscode.LanguageModelResponsePart>,
    token: vscode.CancellationToken,
  ): Promise<void> {
    const modelId = modelInfo.id;
    const startTime = Date.now();

    // Tracks whether anything reached the user, which decides whether failover
    // is still safe (see ProgressProbe).
    const probe = new ProgressProbe(progress);

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
        probe,
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

      if (isTransientError(error)) {
        const triedProviders = new Set<string>([activeProviderId]);
        let lastError = error;
        // Chain the lookup from the model that just failed. Always resolving
        // the *original* model made the loop re-read the same entry, so the
        // second hop saw an already-tried provider and bailed out — the
        // multi-level failover below could never go past one hop.
        let activeModelId = modelId;

        // Multi-level failover: keep trying fallback providers until one succeeds or none remain
        while (true) {
          const fallback = this.findFallbackProvider(
            activeModelId,
            triedProviders,
          );
          if (!fallback) {
            break;
          }

          const {
            provider: fallbackProvider,
            providerId: fallbackPid,
            fallbackModelId,
          } = fallback;

          // Failover re-sends the whole prompt, but parts already handed to
          // `progress` cannot be retracted — they are on screen. Switching
          // providers now would show the beginning of the response twice, so
          // only fail over while this request has emitted nothing.
          if (probe.hasEmitted) {
            logger.router.warn(
              `Not failing over for "${activeModelId}": output was already streamed for this request, so re-sending the prompt would duplicate it`,
            );
            break;
          }

          triedProviders.add(fallbackPid);

          logger.router.warn(
            `Failover to "${fallbackPid}" for model "${modelId}" -> "${fallbackModelId}" after error: ${lastError instanceof Error ? lastError.message : String(lastError)}`,
          );

          // Re-target the request at the fallback model so the fallback
          // provider resolves the correct model definition and API model ID.
          const fallbackModelInfo: vscode.LanguageModelChatInformation = {
            ...modelInfo,
            id: fallbackModelId,
          };

          const fallbackStart = Date.now();
          try {
            await fallbackProvider.provideLanguageModelChatResponse(
              fallbackModelInfo,
              messages,
              options,
              probe,
              token,
            );
            this.latencyTracker.record({
              providerId: fallbackPid,
              modelId: fallbackModelId,
              duration: Date.now() - fallbackStart,
              success: true,
              timestamp: Date.now(),
            });
            return;
          } catch (fallbackError) {
            this.latencyTracker.record({
              providerId: fallbackPid,
              modelId: fallbackModelId,
              duration: Date.now() - fallbackStart,
              success: false,
              timestamp: Date.now(),
            });

            if (!isTransientError(fallbackError)) {
              throw fallbackError;
            }
            lastError = fallbackError;
            // Next hop resolves the failover mapping for the model we just
            // attempted, so A→B→C chains work.
            activeModelId = fallbackModelId;
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
      // The provider went away between listing the model and counting a prompt
      // (its settings were disabled, say). Answer with a real estimate rather
      // than 0: VS Code reads 0 as "this prompt costs nothing" and may let an
      // over-long context through, which is worse than being approximate.
      logger.router.warn(
        `No provider for model "${modelInfo.id}", estimating the token count locally`,
      );
      return estimateTokenCount(text);
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
    this.providerModels.clear();
    this.latencyTracker.clear();
    this.onDidChangeEmitter.dispose();
  }

  /**
   * Invalidate cached routing configuration so changes take effect immediately.
   * Called when copilot-models configuration changes.
   */
  invalidateConfigCache(): void {
    this.failoverModelsCache = null;
    this.failoverModelsCacheTime = 0;
    this.routingStrategyCache = null;
    this.routingStrategyCacheTime = 0;
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
      this.failoverModelsCache = getConfiguredFailoverModels();
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
      this.routingStrategyCache = getConfiguredRoutingStrategy();
      this.routingStrategyCacheTime = Date.now();
      return this.routingStrategyCache;
    } catch {
      return "failover";
    }
  }

  /**
   * Race a promise against a timeout so a slow provider cannot stall the
   * aggregated model list forever.
   */
  private async withTimeout<T>(
    promise: PromiseLike<T> | T | undefined,
    timeoutMs: number,
    providerId: string,
  ): Promise<T | undefined> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        reject(new TimeoutError(providerId, timeoutMs));
      }, timeoutMs);
    });
    try {
      return await Promise.race([Promise.resolve(promise), timeout]);
    } finally {
      if (timer) {
        clearTimeout(timer);
      }
    }
  }
}

/**
 * Decide whether an error is worth failing over for.
 *
 * Circuit breaker rejections count as transient: an open circuit means the
 * provider is temporarily unhealthy, which is exactly the case failover exists
 * for. Without this the error is rethrown straight to the user and the
 * fallback chain never runs.
 */
export function isTransientError(error: unknown): boolean {
  if (error instanceof CircuitBreakerError) {
    return true;
  }

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
