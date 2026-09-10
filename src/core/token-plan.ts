/**
 * TokenPlan — 统一管理 token plan 的类型定义、服务商预设和运行时操作
 *
 * src/plans/ 目录只定义纯数据对象（ProviderPreset），注入到 TokenPlan 类中。
 */

import vscode from "vscode";
import { logger } from "./logger";
import { sanitizeUrl } from "./sanitize";
import { createSingletonStore } from "./singleton";

// ── Types ────────────────────────────────────────────

export interface TokenPlanModel {
  id: string;
}

export interface TokenPlanConfig {
  planId: string;
  planName: string;
  baseUrl: string;
  providerId?: string | undefined;
  models: TokenPlanModel[];
  stream?: boolean | undefined;
  createdAt: number;
  updatedAt: number;
}

/**
 * One recorded request's token usage.
 *
 * Covers every request the extension serves, not only token plan ones:
 * `planId` is absent when the request used a directly configured API key.
 */
export interface TokenConsumption {
  /** Token plan that paid for the request; absent for direct API-key access. */
  planId?: string | undefined;
  /** Provider that served the request. */
  providerId?: string | undefined;
  modelId: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  timestamp: number;
}

export interface ProviderPreset {
  id: string;
  defaultBaseUrl: string;
  models: TokenPlanModel[];
}

export interface PlanOverride {
  planId: string;
  baseUrl: string;
  apiKey: string;
  consumptionRate: number;
  stream: boolean;
}

// ── Constants ────────────────────────────────────────

const PLANS_STORAGE_KEY = "copilot-models.tokenPlans";
const CONSUMPTION_STORAGE_KEY = "copilot-models.tokenPlanConsumptions";
/**
 * Maximum number of usage records kept. Older entries are dropped, so the
 * all-time figures are a rolling window rather than a lifetime total.
 *
 * The key is named after token plans for backward compatibility; the log has
 * covered every request since usage tracking was generalised.
 */
export const MAX_CONSUMPTION_RECORDS = 1000;

// ── TokenPlan Class ──────────────────────────────────

export class TokenPlan {
  private static store = createSingletonStore<TokenPlan>();

  private readonly context: vscode.ExtensionContext;
  private readonly presets: ProviderPreset[];

  /**
   * Fired whenever the usage log changes — a record was persisted, or the log
   * was cleared. Lets the status bar refresh without polling.
   */
  private readonly onDidChangeUsageEmitter = new vscode.EventEmitter<void>();
  readonly onDidChangeUsage: vscode.Event<void> =
    this.onDidChangeUsageEmitter.event;

  private constructor(
    context: vscode.ExtensionContext,
    presets: ProviderPreset[],
  ) {
    this.context = context;
    this.presets = presets;
  }

  /** 初始化单例（在 extension activate 时调用一次） */
  static init(
    context: vscode.ExtensionContext,
    presets: ProviderPreset[],
  ): TokenPlan {
    const instance = new TokenPlan(context, presets);
    TokenPlan.store.set(instance);
    return instance;
  }

  static getInstance(): TokenPlan {
    return TokenPlan.store.get();
  }

  /** 重置实例并释放资源（测试与扩展停用时使用） */
  static resetInstance(): void {
    TokenPlan.store.getOptional()?.dispose();
    TokenPlan.store.reset();
  }

  /** Release resources (event emitter). */
  dispose(): void {
    this.onDidChangeUsageEmitter.dispose();
  }

  // ── 服务商预设 ───────────────────────────────────

  getPresets(): ProviderPreset[] {
    return this.presets;
  }

  detectProviderFromUrl(url: string): ProviderPreset | undefined {
    const hostname = this.extractHostname(url);
    for (const preset of this.presets) {
      const presetHostname = this.extractHostname(preset.defaultBaseUrl);
      if (
        hostname === presetHostname ||
        hostname.endsWith("." + presetHostname)
      ) {
        return preset;
      }
    }
    return undefined;
  }

  extractHostname(url: string): string {
    try {
      return new URL(url).hostname;
    } catch {
      return url;
    }
  }

  // ── Plan CRUD ────────────────────────────────────

  getPlans(): TokenPlanConfig[] {
    return this.context.globalState.get<TokenPlanConfig[]>(
      PLANS_STORAGE_KEY,
      [],
    );
  }

  async storePlan(plan: TokenPlanConfig): Promise<void> {
    const plans = this.getPlans();
    const idx = plans.findIndex((p) => p.planId === plan.planId);
    if (idx >= 0) {
      plans[idx] = plan;
    } else {
      plans.push(plan);
    }
    await this.context.globalState.update(PLANS_STORAGE_KEY, plans);
  }

  async removePlan(planId: string): Promise<void> {
    const plans = this.getPlans().filter((p) => p.planId !== planId);
    await this.context.globalState.update(PLANS_STORAGE_KEY, plans);
  }

  generatePlanId(baseUrl: string): string {
    try {
      const hostname = new URL(baseUrl).hostname.replace(/[^a-z0-9]/g, "-");
      return `plan-${hostname}-${Date.now()}`;
    } catch {
      return `plan-${Date.now()}`;
    }
  }

  /** 获取所有 plan 覆盖的 model ID 集合 */
  getPlanModelIds(): Set<string> {
    const ids = new Set<string>();
    for (const plan of this.getPlans()) {
      for (const model of plan.models) {
        ids.add(model.id);
      }
    }
    return ids;
  }

  // ── Token 管理 ───────────────────────────────────

  private buildSecretKey(planId: string): string {
    return `copilot-models.tokenPlan.${planId}.token`;
  }

  async getToken(planId: string): Promise<string | undefined> {
    return this.context.secrets.get(this.buildSecretKey(planId));
  }

  async storeToken(planId: string, token: string): Promise<void> {
    await this.context.secrets.store(this.buildSecretKey(planId), token);
  }

  async removeToken(planId: string): Promise<void> {
    try {
      await this.context.secrets.delete(this.buildSecretKey(planId));
    } catch {
      // may not exist
    }
  }

  // ── 消费记录 ─────────────────────────────────────

  /**
   * In-memory view of the consumption log, loaded lazily from globalState.
   * Kept so read-modify-write cycles do not re-materialize the whole array
   * on every recorded response.
   */
  private consumptionCache: TokenConsumption[] | undefined;

  /**
   * Serializes consumption writes.
   *
   * `recordConsumption` is a read-modify-write over globalState and can be
   * invoked concurrently (several chat requests in flight at once). Without
   * serialization every writer reads the same snapshot and the last write
   * wins, so all but one record were silently dropped.
   */
  private consumptionWriteChain: Promise<void> = Promise.resolve();

  private getConsumptionRecords(): TokenConsumption[] {
    if (!this.consumptionCache) {
      this.consumptionCache = [
        ...this.context.globalState.get<TokenConsumption[]>(
          CONSUMPTION_STORAGE_KEY,
          [],
        ),
      ];
    }
    return this.consumptionCache;
  }

  async recordConsumption(consumption: TokenConsumption): Promise<void> {
    const records = this.getConsumptionRecords();
    records.push(consumption);
    if (records.length > MAX_CONSUMPTION_RECORDS) {
      records.splice(0, records.length - MAX_CONSUMPTION_RECORDS);
    }

    // Queue the write behind any in-flight one so no update is lost. The
    // snapshot is taken when the write actually runs, so the final write
    // always persists the complete log.
    this.consumptionWriteChain = this.consumptionWriteChain
      .catch(() => {
        // A previous write failed; keep the chain alive so later records
        // are still persisted.
      })
      .then(() =>
        this.context.globalState.update(CONSUMPTION_STORAGE_KEY, [...records]),
      );

    await this.consumptionWriteChain;
    this.onDidChangeUsageEmitter.fire();
    logger.plan.debug(
      `Recorded consumption: ${consumption.totalTokens} tokens for ${consumption.planId ?? "direct API key"}`,
    );
  }

  getConsumptions(): TokenConsumption[] {
    // Copy so callers cannot mutate the cached log.
    return [...this.getConsumptionRecords()];
  }

  /** Drop every recorded usage entry, persisting the empty log. */
  async clearConsumptions(): Promise<void> {
    const dropped = this.getConsumptionRecords().length;
    this.consumptionCache = [];

    this.consumptionWriteChain = this.consumptionWriteChain
      .catch(() => {
        // Keep the chain alive after a failed write.
      })
      .then(() => this.context.globalState.update(CONSUMPTION_STORAGE_KEY, []));

    await this.consumptionWriteChain;
    // Must notify: the status bar still shows the pre-clear figures otherwise.
    this.onDidChangeUsageEmitter.fire();
    logger.plan.info(`Cleared ${dropped} usage record(s)`);
  }

  // ── 运行时查询（chat-provider 使用） ─────────────

  /**
   * 根据 modelId 解析 plan override。
   * 如果有 plan 覆盖该模型且 token 有效，返回 PlanOverride；否则返回 undefined。
   */
  async resolvePlanOverride(
    modelId: string,
  ): Promise<PlanOverride | undefined> {
    const plans = this.getPlans();
    logger.plan.debug(
      `resolvePlanOverride: modelId="${modelId}", plans=${plans.length}`,
    );
    if (plans.length > 0) {
      for (const p of plans) {
        logger.plan.debug(
          `  plan "${p.planName}" models: [${p.models.map((m) => m.id).join(", ")}] url: ${p.baseUrl}`,
        );
      }
    }

    const matchingPlan = plans.find((p) =>
      p.models.some((m) => m.id === modelId),
    );
    if (!matchingPlan) {
      logger.plan.debug(`  → no matching plan for "${modelId}"`);
      return undefined;
    }

    const token = await this.getToken(matchingPlan.planId);
    if (!token) {
      logger.plan.debug(
        `  → plan "${matchingPlan.planName}" matched but no token stored`,
      );
      return undefined;
    }

    logger.plan.debug(
      `  → using plan "${matchingPlan.planName}" url=${sanitizeUrl(matchingPlan.baseUrl)}`,
    );
    return {
      planId: matchingPlan.planId,
      baseUrl: matchingPlan.baseUrl,
      apiKey: token,
      consumptionRate: 1,
      stream: matchingPlan.stream !== false,
    };
  }
}
