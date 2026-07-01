/**
 * TokenPlan — 统一管理 token plan 的类型定义、服务商预设和运行时操作
 *
 * src/plans/ 目录只定义纯数据对象（ProviderPreset），注入到 TokenPlan 类中。
 */

import vscode from "vscode";
import { logger } from "./logger";

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

export interface TokenPlanConsumption {
  planId: string;
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
const MAX_CONSUMPTION_RECORDS = 1000;

// ── TokenPlan Class ──────────────────────────────────

export class TokenPlan {
  private static instance: TokenPlan | undefined;
  private readonly context: vscode.ExtensionContext;
  private readonly presets: ProviderPreset[];

  private constructor(context: vscode.ExtensionContext, presets: ProviderPreset[]) {
    this.context = context;
    this.presets = presets;
  }

  /** 初始化单例（在 extension activate 时调用一次） */
  static init(context: vscode.ExtensionContext, presets: ProviderPreset[]): TokenPlan {
    TokenPlan.instance = new TokenPlan(context, presets);
    return TokenPlan.instance;
  }

  static getInstance(): TokenPlan {
    if (!TokenPlan.instance) {
      throw new Error("TokenPlan not initialized. Call TokenPlan.init(context) first.");
    }
    return TokenPlan.instance;
  }

  /** 重置实例（仅测试用） */
  static resetInstance(): void {
    TokenPlan.instance = undefined;
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
        hostname === presetHostname || hostname.endsWith("." + presetHostname)
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
    return this.context.globalState.get<TokenPlanConfig[]>(PLANS_STORAGE_KEY, []);
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

  async recordConsumption(consumption: TokenPlanConsumption): Promise<void> {
    const records = this.context.globalState.get<TokenPlanConsumption[]>(CONSUMPTION_STORAGE_KEY, []);
    records.push(consumption);
    if (records.length > MAX_CONSUMPTION_RECORDS) {
      records.splice(0, records.length - MAX_CONSUMPTION_RECORDS);
    }
    await this.context.globalState.update(CONSUMPTION_STORAGE_KEY, records);
    logger.plan.debug(
      `Recorded consumption: ${consumption.totalTokens} tokens for plan ${consumption.planId}`,
    );
  }

  getConsumptions(): TokenPlanConsumption[] {
    return this.context.globalState.get<TokenPlanConsumption[]>(CONSUMPTION_STORAGE_KEY, []);
  }

  // ── 运行时查询（chat-provider 使用） ─────────────

  /**
   * 根据 modelId 解析 plan override。
   * 如果有 plan 覆盖该模型且 token 有效，返回 PlanOverride；否则返回 undefined。
   */
  async resolvePlanOverride(modelId: string): Promise<PlanOverride | undefined> {
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

    const planModel = matchingPlan.models.find((m) => m.id === modelId);
    logger.plan.debug(
      `  → using plan "${matchingPlan.planName}" url=${matchingPlan.baseUrl}`,
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
