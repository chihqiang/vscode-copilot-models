/**
 * Tests for the token usage status bar item.
 *
 * Runs in the extension host so the real `StatusBarItem` and configuration
 * APIs are exercised. The plan manager is stubbed so the TokenPlan singleton
 * used by the running extension is left untouched.
 */

import * as assert from "assert";
import * as vscode from "vscode";
import { CONFIG_SECTION } from "../core/models";
import type { TokenConsumption, TokenPlan } from "../core/token-plan";
import { SHOW_STATUS_BAR_SETTING, UsageStatusBar } from "../ui/status-bar";

/** Stand-in for TokenPlan with a controllable usage event. */
class FakeTokenPlan {
  private readonly emitter = new vscode.EventEmitter<TokenConsumption>();
  private records: TokenConsumption[] = [];

  readonly onDidRecordUsage = this.emitter.event;

  getConsumptions(): TokenConsumption[] {
    return [...this.records];
  }

  /** Append a record and notify listeners, as a real request would. */
  add(record: TokenConsumption): void {
    this.records.push(record);
    this.emitter.fire(record);
  }

  asTokenPlan(): TokenPlan {
    return this as unknown as TokenPlan;
  }

  dispose(): void {
    this.emitter.dispose();
  }
}

function createRecord(
  timestamp: number,
  totalTokens: number,
): TokenConsumption {
  return {
    modelId: "deepseek-flash",
    promptTokens: totalTokens,
    completionTokens: 0,
    totalTokens,
    timestamp,
  };
}

async function setShowStatusBar(value: boolean | undefined): Promise<void> {
  await vscode.workspace
    .getConfiguration(CONFIG_SECTION)
    .update(SHOW_STATUS_BAR_SETTING, value, vscode.ConfigurationTarget.Global);
}

suite("UsageStatusBar Test Suite", () => {
  let plan: FakeTokenPlan;
  let statusBar: UsageStatusBar;

  setup(() => {
    plan = new FakeTokenPlan();
    statusBar = new UsageStatusBar(plan.asTokenPlan());
  });

  teardown(async () => {
    statusBar.dispose();
    plan.dispose();
    await setShowStatusBar(undefined);
  });

  test("stays hidden until something has been recorded", () => {
    assert.strictEqual(
      statusBar.isVisible,
      false,
      "a fresh install should not show a permanent 0-token item",
    );
  });

  test("appears and updates when usage is recorded", () => {
    plan.add(createRecord(Date.now(), 1000));

    assert.strictEqual(statusBar.isVisible, true);
    assert.strictEqual(statusBar.text, "$(pulse) 1K tok · 1 req");

    plan.add(createRecord(Date.now(), 500));

    assert.strictEqual(
      statusBar.text,
      "$(pulse) 1.5K tok · 2 req",
      "the item must refresh on every recorded request",
    );
  });

  test("counts only today's usage", () => {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);

    plan.add(createRecord(yesterday.getTime(), 999_999));
    plan.add(createRecord(Date.now(), 2000));

    assert.strictEqual(
      statusBar.text,
      "$(pulse) 2K tok · 1 req",
      "yesterday's usage must not appear in today's figure",
    );
    assert.strictEqual(statusBar.isVisible, true);
  });

  test("honours the showStatusBar setting", async () => {
    plan.add(createRecord(Date.now(), 1000));
    assert.strictEqual(statusBar.isVisible, true);

    await setShowStatusBar(false);
    statusBar.refresh();
    assert.strictEqual(
      statusBar.isVisible,
      false,
      "disabling the setting must hide the item",
    );

    await setShowStatusBar(true);
    statusBar.refresh();
    assert.strictEqual(
      statusBar.isVisible,
      true,
      "re-enabling the setting must bring the item back",
    );
  });
});
