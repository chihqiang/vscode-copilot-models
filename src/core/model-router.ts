/**
 * 模型路由器 - 在多个 provider 间路由请求，支持故障转移和延迟跟踪
 *
 * 核心职责：
 * - 聚合所有 provider 的模型列表，对外暴露统一接口
 * - 按模型 ID 分发请求到对应 provider
 * - 支持故障转移：主 provider 失败后自动切换到备用 provider
 * - 支持延迟感知路由：选择历史延迟最低的 provider
 */

import vscode from 'vscode';
import { IChatProvider } from './chat-provider';
import { ModelRegistry } from './model-registry';
import { logger } from './logger';
import { NetworkError, RateLimitError, ServiceUnavailableError, TimeoutError } from './client';

/** 路由策略 */
export type RoutingStrategy = 'failover' | 'latency';

/** 单次请求延迟记录 */
export interface LatencyRecord {
  providerId: string;
  modelId: string;
  duration: number;
  success: boolean;
  timestamp: number;
}

/** 延迟统计（滑动窗口） */
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
 * 延迟追踪器
 * 维护每个 provider 的滑动窗口延迟记录，用于延迟感知路由
 */
export class LatencyTracker {
  private records: Map<string, LatencyRecord[]> = new Map();

  /** 记录一次请求的延迟数据 */
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

  /** 获取指定 provider 的延迟统计（仅统计成功请求） */
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

  /** 获取所有 provider 的延迟统计 */
  getAllStats(): Map<string, LatencyStats> {
    const result = new Map<string, LatencyStats>();
    for (const providerId of this.records.keys()) {
      const stats = this.getStats(providerId);
      if (stats) {result.set(providerId, stats);}
    }
    return result;
  }

  /** 清空所有记录 */
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

/** 从配置读取路由策略 */
function getRoutingStrategy(): RoutingStrategy {
  try {
    const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
    return config.get<RoutingStrategy>('routingStrategy', 'failover');
  } catch {
    return 'failover';
  }
}

/**
 * 判断是否为可转移的临时错误
 * 这类错误（超时/网络/限流等）适合触发故障转移
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

  /** 注册一个 provider 及其托管的模型列表 */
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

  /** 移除一个 provider */
  removeProvider(providerId: string): void {
    this.providers.delete(providerId);
    this.providerModels.delete(providerId);
    for (const [modelId, pid] of this.modelToPrimaryProvider) {
      if (pid === providerId) {
        this.modelToPrimaryProvider.delete(modelId);
      }
    }
  }

  /** 获取所有已注册的 provider ID */
  getProviderIds(): string[] {
    return Array.from(this.providers.keys());
  }

  /** 检查指定 provider 是否已注册 */
  hasProvider(providerId: string): boolean {
    return this.providers.has(providerId);
  }

  /** 根据模型 ID 查找对应的 provider */
  private findProviderForModel(modelId: string): IChatProvider | undefined {
    const pid = this.modelToPrimaryProvider.get(modelId);
    if (pid) {return this.providers.get(pid);}
    return undefined;
  }

  /** 查找故障转移的备用 provider */
  private findFallbackProvider(failedModelId: string, failedProviderId: string): IChatProvider | undefined {
    const failoverModels = getFailoverModels();
    const fallbackModelId = failoverModels[failedModelId];
    if (!fallbackModelId) {return undefined;}

    const registry = ModelRegistry.getInstance();
    const fallbackProvider = registry.findProviderByModelId(fallbackModelId);
    if (!fallbackProvider || fallbackProvider.id === failedProviderId) {return undefined;}

    return this.providers.get(fallbackProvider.id);
  }

  /**
   * 延迟感知路由选择
   * 在多个可提供同一模型的 provider 中，选择历史延迟最低的
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
