/**
 * Command registration — all VS Code commands for Copilot Models
 */

import vscode from "vscode";
import {
  logger,
  CONFIG_SECTION,
  MAX_CONSUMPTION_RECORDS,
  TokenPlan,
  buildUsageSummary,
  collectProviderBalances,
  formatBalanceSection,
  formatUsageReport,
  type ModelRouter,
} from "../core";
import { confirmAction } from "../wizard/utils";
import {
  COMMAND_CLEAR_API_KEY,
  COMMAND_CLEAR_LOG,
  COMMAND_CLEAR_TOKEN_PLAN,
  COMMAND_CLEAR_TOKEN_USAGE,
  COMMAND_CLEAR_VISION_MODEL,
  COMMAND_OPEN_SETTINGS,
  COMMAND_REFRESH_MODELS,
  COMMAND_SET_API_KEY,
  COMMAND_SET_TOKEN_PLAN,
  COMMAND_SET_VISION_MODEL,
  COMMAND_SHOW_LATENCY_STATS,
  COMMAND_SHOW_LOG,
  COMMAND_SHOW_TOKEN_USAGE,
} from "./command-ids";
import {
  openSetApiKeyWizard,
  openClearApiKeyWizard,
} from "../wizard/set-api-key";
import {
  openSetTokenPlanWizard,
  openClearTokenPlanWizard,
} from "../wizard/set-token-plan";
import {
  openSetVisionModelWizard,
  openClearVisionModelWizard,
} from "../wizard/set-vision-model";

/** Wrap an async command handler with error handling */
function safeAsync(name: string, fn: () => Promise<void>): () => Promise<void> {
  return async () => {
    try {
      await fn();
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.core.error(`Command "${name}" failed:`, error);
      vscode.window.showErrorMessage(`Copilot Models: ${msg}`);
    }
  };
}

/**
 * Register a command and add its disposable to context.subscriptions
 * so it is properly cleaned up on extension deactivation.
 */
function registerCommand(
  context: vscode.ExtensionContext,
  command: string,
  callback: (...args: unknown[]) => unknown,
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand(
      command,
      callback as (...args: unknown[]) => void,
    ),
  );
}

export function registerAllCommands(
  context: vscode.ExtensionContext,
  modelRouter: ModelRouter,
): void {
  // ── API Key ───────────────────────────────────────

  registerCommand(
    context,
    COMMAND_SET_API_KEY,
    safeAsync("setApiKey", openSetApiKeyWizard),
  );

  registerCommand(
    context,
    COMMAND_CLEAR_API_KEY,
    safeAsync("clearApiKey", openClearApiKeyWizard),
  );

  // ── Settings & Logging ────────────────────────────

  registerCommand(context, COMMAND_OPEN_SETTINGS, async () => {
    logger.core.info("openSettings command invoked");
    await vscode.commands.executeCommand(
      "workbench.action.openSettings",
      CONFIG_SECTION,
    );
  });

  registerCommand(context, COMMAND_SHOW_LOG, () => {
    logger.core.info("showLog command invoked");
    logger.show();
  });

  registerCommand(context, COMMAND_CLEAR_LOG, () => {
    logger.core.info("clearLog command invoked");
    logger.clear();
  });

  // ── Models ────────────────────────────────────────

  registerCommand(
    context,
    COMMAND_REFRESH_MODELS,
    safeAsync("refreshModels", async () => {
      logger.core.info("refreshModels command invoked");
      modelRouter.refreshModelPicker();
      logger.core.info("Models refreshed successfully");
    }),
  );

  // ── Token Plan ────────────────────────────────────

  registerCommand(
    context,
    COMMAND_SET_TOKEN_PLAN,
    safeAsync("setTokenPlan", openSetTokenPlanWizard),
  );

  registerCommand(
    context,
    COMMAND_CLEAR_TOKEN_PLAN,
    safeAsync("clearTokenPlan", openClearTokenPlanWizard),
  );

  // ── Latency Stats ─────────────────────────────────

  registerCommand(context, COMMAND_SHOW_LATENCY_STATS, () => {
    const stats = modelRouter.latencyTracker.getAllStats();
    if (stats.size === 0) {
      vscode.window.showInformationMessage("No latency data available");
      return;
    }
    const lines = Array.from(stats.entries()).map(
      ([id, s]) =>
        `${id}: avg=${s.averageMs.toFixed(0)}ms, min=${s.minMs}ms, max=${s.maxMs}ms (${s.count} samples)`,
    );
    vscode.window.showInformationMessage(
      "Latency stats:\n" + lines.join("\n"),
      { modal: true },
    );
  });

  // ── Token Usage ───────────────────────────────────

  registerCommand(
    context,
    COMMAND_SHOW_TOKEN_USAGE,
    safeAsync("showTokenUsage", async () => {
      logger.core.info("showTokenUsage command invoked");
      const records = TokenPlan.getInstance().getConsumptions();
      // Balance is best-effort: providers without a balance API are skipped and
      // failures degrade to an "unavailable" line inside the report.
      const balances = await collectProviderBalances();
      const hasReportableBalance = formatBalanceSection(balances).length > 0;

      // A fresh install has no usage yet, but the balance is still worth
      // showing — configure the key and this is the first thing to check.
      if (records.length === 0 && !hasReportableBalance) {
        vscode.window.showInformationMessage("No token usage recorded yet");
        return;
      }

      const summary = buildUsageSummary(records, Date.now());
      await vscode.window.showInformationMessage(
        formatUsageReport(summary, {
          retentionLimit: MAX_CONSUMPTION_RECORDS,
          balances,
        }),
        { modal: true },
      );
    }),
  );

  registerCommand(
    context,
    COMMAND_CLEAR_TOKEN_USAGE,
    safeAsync("clearTokenUsage", async () => {
      const confirmed = await confirmAction(
        "Clear all recorded token usage?",
        "Clear",
      );
      if (!confirmed) {
        return;
      }

      await TokenPlan.getInstance().clearConsumptions();
      vscode.window.showInformationMessage("Token usage cleared");
    }),
  );

  // ── Vision Model ─────────────────────────────────

  registerCommand(
    context,
    COMMAND_SET_VISION_MODEL,
    safeAsync("setVisionModel", () => openSetVisionModelWizard(context)),
  );

  registerCommand(
    context,
    COMMAND_CLEAR_VISION_MODEL,
    safeAsync("clearVisionModel", () => openClearVisionModelWizard(context)),
  );
}
