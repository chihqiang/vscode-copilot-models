/**
 * Status bar item showing today's token usage.
 *
 * The item is refreshed from the recorded usage log: when `TokenPlan` reports a
 * change (`onDidChangeUsage`, which fires both after a request records its
 * usage and when the log is cleared) and when the visibility setting changes.
 * Clicking it opens the usage report.
 */

import vscode from "vscode";
import { logger } from "../core/logger";
import { CONFIG_SECTION } from "../core/models";
import {
  getShowStatusBar,
  SHOW_STATUS_BAR_SETTING as SHOW_STATUS_BAR_SETTING_KEY,
} from "../core/settings";
import type { TokenPlan } from "../core/token-plan";
import {
  buildStatusBarTooltip,
  buildUsageSummary,
  formatStatusBarText,
} from "../core/usage-stats";
import { COMMAND_SHOW_TOKEN_USAGE } from "../commands/command-ids";

/** Setting that controls status bar visibility. */
export const SHOW_STATUS_BAR_SETTING = SHOW_STATUS_BAR_SETTING_KEY;

/** Command invoked when the status bar item is clicked. */
export const SHOW_TOKEN_USAGE_COMMAND = COMMAND_SHOW_TOKEN_USAGE;

export class UsageStatusBar implements vscode.Disposable {
  private readonly item: vscode.StatusBarItem;
  private readonly disposables: vscode.Disposable[] = [];
  private visible = false;

  constructor(private readonly tokenPlan: TokenPlan) {
    this.item = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Right,
      100,
    );
    this.item.command = SHOW_TOKEN_USAGE_COMMAND;

    this.disposables.push(
      this.item,
      // Fires on both recorded usage and a cleared log, so the item can never
      // show stale figures.
      tokenPlan.onDidChangeUsage(() => this.refresh()),
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (
          e.affectsConfiguration(`${CONFIG_SECTION}.${SHOW_STATUS_BAR_SETTING}`)
        ) {
          this.refresh();
        }
      }),
    );

    this.refresh();
  }

  /** Recompute the text and tooltip, applying the visibility setting. */
  refresh(): void {
    if (!getShowStatusBar()) {
      this.setVisible(false);
      return;
    }

    const now = Date.now();
    const summary = buildUsageSummary(this.tokenPlan.getConsumptions(), now);

    // Nothing recorded yet: stay out of the status bar rather than showing a
    // permanent "0 tok" item on a fresh install.
    if (summary.allTime.requests === 0) {
      this.setVisible(false);
      return;
    }

    this.item.text = formatStatusBarText(summary.today);
    this.item.tooltip = new vscode.MarkdownString(
      buildStatusBarTooltip(summary, now).join("\n\n"),
    );
    this.setVisible(true);

    logger.config.debug(
      `Status bar updated: today=${summary.today.totalTokens} tokens / ${summary.today.requests} request(s)`,
    );
  }

  /** Whether the item is currently shown (tests / diagnostics). */
  get isVisible(): boolean {
    return this.visible;
  }

  /** Current status bar text (tests / diagnostics). */
  get text(): string {
    return this.item.text;
  }

  private setVisible(visible: boolean): void {
    this.visible = visible;
    if (visible) {
      this.item.show();
    } else {
      this.item.hide();
    }
  }

  dispose(): void {
    this.disposables.forEach((d) => d.dispose());
    this.disposables.length = 0;
  }
}
