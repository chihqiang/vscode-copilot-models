/**
 * Command registration — all VS Code commands for Copilot Models
 */

import vscode from "vscode";
import { logger, type ModelRouter } from "../core";
import {
  openSetApiKeyWizard,
  openClearApiKeyWizard,
} from "../wizard/set-api-key";
import {
  openSetTokenPlanWizard,
  openClearTokenPlanWizard,
} from "../wizard/set-token-plan";

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

export function registerAllCommands(
  _context: vscode.ExtensionContext,
  modelRouter: ModelRouter,
): void {
  // ── API Key ───────────────────────────────────────

  vscode.commands.registerCommand(
    "copilot-models.setApiKey",
    safeAsync("setApiKey", openSetApiKeyWizard),
  );

  vscode.commands.registerCommand(
    "copilot-models.clearApiKey",
    safeAsync("clearApiKey", openClearApiKeyWizard),
  );

  // ── Settings & Logging ────────────────────────────

  vscode.commands.registerCommand("copilot-models.openSettings", () => {
    logger.core.info("openSettings command invoked");
    vscode.commands.executeCommand(
      "workbench.action.openSettings",
      "copilot-models",
    );
  });

  vscode.commands.registerCommand("copilot-models.showLog", () => {
    logger.core.info("showLog command invoked");
    logger.show();
  });

  vscode.commands.registerCommand("copilot-models.clearLog", () => {
    logger.core.info("clearLog command invoked");
    logger.clear();
  });

  // ── Models ────────────────────────────────────────

  vscode.commands.registerCommand(
    "copilot-models.refreshModels",
    safeAsync("refreshModels", async () => {
      logger.core.info("refreshModels command invoked");
      modelRouter.refreshModelPicker();
      logger.core.info("Models refreshed successfully");
    }),
  );

  // ── Token Plan ────────────────────────────────────

  vscode.commands.registerCommand(
    "copilot-models.setTokenPlan",
    safeAsync("setTokenPlan", openSetTokenPlanWizard),
  );

  vscode.commands.registerCommand(
    "copilot-models.clearTokenPlan",
    safeAsync("clearTokenPlan", openClearTokenPlanWizard),
  );

  // ── Latency Stats ─────────────────────────────────

  vscode.commands.registerCommand("copilot-models.showLatencyStats", () => {
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
}
