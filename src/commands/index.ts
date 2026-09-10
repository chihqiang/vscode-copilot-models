/**
 * Command registration — all VS Code commands for Copilot Models
 */

import vscode from "vscode";
import {
  logger,
  MAX_CONSUMPTION_RECORDS,
  TokenPlan,
  buildUsageSummary,
  formatUsageReport,
  type ModelRouter,
} from "../core";
import { confirmAction } from "../wizard/utils";
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
    "copilot-models.setApiKey",
    safeAsync("setApiKey", openSetApiKeyWizard),
  );

  registerCommand(
    context,
    "copilot-models.clearApiKey",
    safeAsync("clearApiKey", openClearApiKeyWizard),
  );

  // ── Settings & Logging ────────────────────────────

  registerCommand(context, "copilot-models.openSettings", async () => {
    logger.core.info("openSettings command invoked");
    await vscode.commands.executeCommand(
      "workbench.action.openSettings",
      "copilot-models",
    );
  });

  registerCommand(context, "copilot-models.showLog", () => {
    logger.core.info("showLog command invoked");
    logger.show();
  });

  registerCommand(context, "copilot-models.clearLog", () => {
    logger.core.info("clearLog command invoked");
    logger.clear();
  });

  // ── Models ────────────────────────────────────────

  registerCommand(
    context,
    "copilot-models.refreshModels",
    safeAsync("refreshModels", async () => {
      logger.core.info("refreshModels command invoked");
      modelRouter.refreshModelPicker();
      logger.core.info("Models refreshed successfully");
    }),
  );

  // ── Token Plan ────────────────────────────────────

  registerCommand(
    context,
    "copilot-models.setTokenPlan",
    safeAsync("setTokenPlan", openSetTokenPlanWizard),
  );

  registerCommand(
    context,
    "copilot-models.clearTokenPlan",
    safeAsync("clearTokenPlan", openClearTokenPlanWizard),
  );

  // ── Latency Stats ─────────────────────────────────

  registerCommand(context, "copilot-models.showLatencyStats", () => {
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
    "copilot-models.showTokenUsage",
    safeAsync("showTokenUsage", async () => {
      logger.core.info("showTokenUsage command invoked");
      const records = TokenPlan.getInstance().getConsumptions();
      if (records.length === 0) {
        vscode.window.showInformationMessage("No token usage recorded yet");
        return;
      }

      const summary = buildUsageSummary(records, Date.now());
      await vscode.window.showInformationMessage(
        formatUsageReport(summary, MAX_CONSUMPTION_RECORDS),
        { modal: true },
      );
    }),
  );

  registerCommand(
    context,
    "copilot-models.clearTokenUsage",
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
    "copilot-models.setVisionModel",
    safeAsync("setVisionModel", () => openSetVisionModelWizard(context)),
  );

  registerCommand(
    context,
    "copilot-models.clearVisionModel",
    safeAsync("clearVisionModel", () => openClearVisionModelWizard(context)),
  );
}
