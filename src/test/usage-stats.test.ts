/**
 * Tests for token usage aggregation and formatting.
 *
 * These are the pure helpers behind the status bar text and the
 * `Show Token Usage` report, so they are asserted without VS Code APIs.
 */

import * as assert from "assert";
import {
  buildStatusBarTooltip,
  buildUsageSummary,
  emptyUsageTotals,
  formatStatusBarText,
  formatTokenCount,
  formatUsageReport,
  startOfLocalDay,
  sumUsage,
} from "../core/usage-stats";
import type { TokenConsumption } from "../core/token-plan";

/** Build a record; `timestamp` is required, everything else has defaults. */
function record(
  timestamp: number,
  overrides: Partial<TokenConsumption> = {},
): TokenConsumption {
  return {
    modelId: "m1",
    promptTokens: 100,
    completionTokens: 50,
    totalTokens: 150,
    timestamp,
    ...overrides,
  };
}

/** Local-time timestamp for the given calendar day. */
function localTime(
  year: number,
  month: number,
  day: number,
  hour = 12,
  minute = 0,
): number {
  return new Date(year, month - 1, day, hour, minute, 0, 0).getTime();
}

suite("startOfLocalDay Test Suite", () => {
  test("returns local midnight of the same day", () => {
    const noon = localTime(2026, 9, 10, 12, 34);
    const start = startOfLocalDay(noon);
    const date = new Date(start);

    assert.strictEqual(date.getHours(), 0);
    assert.strictEqual(date.getMinutes(), 0);
    assert.strictEqual(date.getSeconds(), 0);
    assert.strictEqual(date.getMilliseconds(), 0);
    assert.strictEqual(date.getDate(), 10);
  });

  test("is stable across the same day and moves at the day boundary", () => {
    const early = localTime(2026, 9, 10, 0, 0);
    const late = localTime(2026, 9, 10, 23, 59);
    assert.strictEqual(startOfLocalDay(early), startOfLocalDay(late));

    const nextDay = localTime(2026, 9, 11, 0, 0);
    assert.ok(startOfLocalDay(nextDay) > startOfLocalDay(late));
  });
});

suite("sumUsage Test Suite", () => {
  test("returns zeroed totals for no records", () => {
    assert.deepStrictEqual(sumUsage([]), emptyUsageTotals());
  });

  test("adds up requests and both token directions", () => {
    const totals = sumUsage([
      record(1, { promptTokens: 10, completionTokens: 5, totalTokens: 15 }),
      record(2, { promptTokens: 20, completionTokens: 25, totalTokens: 45 }),
    ]);

    assert.deepStrictEqual(totals, {
      requests: 2,
      promptTokens: 30,
      completionTokens: 30,
      totalTokens: 60,
    });
  });
});

suite("buildUsageSummary Test Suite", () => {
  const now = localTime(2026, 9, 10, 18, 0);
  const todayMorning = localTime(2026, 9, 10, 8, 0);
  const yesterday = localTime(2026, 9, 9, 23, 30);

  test("splits today from the whole log", () => {
    const summary = buildUsageSummary(
      [
        record(yesterday, { totalTokens: 1000 }),
        record(todayMorning, { totalTokens: 7 }),
      ],
      now,
    );

    assert.strictEqual(summary.today.totalTokens, 7);
    assert.strictEqual(summary.today.requests, 1);
    assert.strictEqual(summary.allTime.totalTokens, 1007);
    assert.strictEqual(summary.allTime.requests, 2);
  });

  test("groups plan-backed and direct requests separately", () => {
    const summary = buildUsageSummary(
      [
        record(now, { planId: "plan-a", totalTokens: 100 }),
        record(now, { planId: "plan-a", totalTokens: 50 }),
        record(now, { totalTokens: 10 }),
      ],
      now,
    );

    const planA = summary.byPlan.find((g) => g.key === "plan-a");
    const direct = summary.byPlan.find((g) => g.key === "");

    assert.strictEqual(planA?.totals.totalTokens, 150);
    assert.strictEqual(planA?.totals.requests, 2);
    assert.strictEqual(direct?.totals.totalTokens, 10);
    assert.strictEqual(direct?.label, "No plan (direct API key)");
  });

  test("sorts groups by tokens and caps the model list", () => {
    const summary = buildUsageSummary(
      [
        record(now, { modelId: "small", totalTokens: 1 }),
        record(now, { modelId: "big", totalTokens: 1000 }),
        record(now, { modelId: "mid", totalTokens: 100 }),
      ],
      now,
      2,
    );

    assert.deepStrictEqual(
      summary.topModels.map((g) => g.key),
      ["big", "mid"],
      "highest usage first, capped at the limit",
    );
  });

  test("reports an empty window for an empty log", () => {
    const summary = buildUsageSummary([], now);
    assert.strictEqual(summary.firstTimestamp, undefined);
    assert.strictEqual(summary.lastTimestamp, undefined);
    assert.strictEqual(summary.allTime.requests, 0);
  });
});

suite("formatTokenCount Test Suite", () => {
  test("keeps small counts exact", () => {
    assert.strictEqual(formatTokenCount(0), "0");
    assert.strictEqual(formatTokenCount(999), "999");
  });

  test("uses K for thousands", () => {
    assert.strictEqual(formatTokenCount(1000), "1K");
    assert.strictEqual(formatTokenCount(1234), "1.2K");
    assert.strictEqual(formatTokenCount(12_345), "12.3K");
  });

  test("uses M for millions", () => {
    assert.strictEqual(formatTokenCount(1_000_000), "1M");
    assert.strictEqual(formatTokenCount(1_234_567), "1.2M");
  });

  test("never renders a rounded 1000 of a smaller unit", () => {
    // 999_999 would round to 1000.0K if the unit were not promoted.
    assert.strictEqual(formatTokenCount(999_999), "1M");
    assert.strictEqual(formatTokenCount(999_950), "1M");
  });

  test("guards against invalid input", () => {
    assert.strictEqual(formatTokenCount(-1), "0");
    assert.strictEqual(formatTokenCount(Number.NaN), "0");
    assert.strictEqual(formatTokenCount(Number.POSITIVE_INFINITY), "0");
  });
});

suite("formatStatusBarText Test Suite", () => {
  test("shows today's tokens and request count", () => {
    const text = formatStatusBarText({
      requests: 18,
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 12_345,
    });

    assert.strictEqual(text, "$(pulse) 12.3K tok · 18 req");
  });
});

suite("buildStatusBarTooltip Test Suite", () => {
  const now = localTime(2026, 9, 10, 18, 0);

  test("includes today and all-time totals", () => {
    const summary = buildUsageSummary(
      [record(localTime(2026, 9, 10, 9, 0), { totalTokens: 1000 })],
      now,
    );
    const text = buildStatusBarTooltip(summary, now).join("\n");

    assert.ok(text.includes("Token Usage"));
    assert.ok(text.includes("Today: 1K tokens in 1 request(s)"));
    assert.ok(text.includes("All time: 1K tokens in 1 request(s)"));
  });

  test("omits the last-request line when nothing was recorded", () => {
    const text = buildStatusBarTooltip(buildUsageSummary([], now), now).join(
      "\n",
    );
    assert.ok(!text.includes("Last request"));
  });
});

suite("formatUsageReport Test Suite", () => {
  const now = localTime(2026, 9, 10, 18, 0);

  test("lists plan and model breakdowns", () => {
    const summary = buildUsageSummary(
      [
        record(now, { planId: "plan-a", modelId: "glm-5.2", totalTokens: 500 }),
        record(now, { modelId: "deepseek-flash", totalTokens: 100 }),
      ],
      now,
    );
    const report = formatUsageReport(summary, 1000);

    assert.ok(report.includes("Today:"));
    assert.ok(report.includes("All time:"));
    assert.ok(report.includes("By plan:"));
    assert.ok(report.includes("plan-a"));
    assert.ok(report.includes("No plan (direct API key)"));
    assert.ok(report.includes("Top models:"));
    assert.ok(report.includes("glm-5.2"));
  });

  test("surfaces the retention cap so all-time is not read as a lifetime total", () => {
    const report = formatUsageReport(
      buildUsageSummary([record(now)], now),
      1000,
    );
    assert.ok(report.includes("most recent 1000 records"));
  });

  test("omits the retention note when no cap is given", () => {
    const report = formatUsageReport(buildUsageSummary([record(now)], now));
    assert.ok(!report.includes("Retention"));
  });
});
