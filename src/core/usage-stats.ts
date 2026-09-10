/**
 * Token usage aggregation.
 *
 * Pure helpers over the recorded consumption log, kept free of VS Code APIs so
 * the status bar text and the `Show Token Usage` report stay unit testable.
 */

import type { TokenConsumption } from "./token-plan";

// ── Types ────────────────────────────────────────────

/** Aggregated token counts for a set of requests. */
export interface UsageTotals {
  requests: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

/** A named group of totals (one plan, one model). */
export interface UsageGroup {
  /** Stable identifier: plan ID, model ID, or "" for direct API-key access. */
  key: string;
  /** Human readable label for reports. */
  label: string;
  totals: UsageTotals;
}

/** Everything the status bar and the usage report need. */
export interface UsageSummary {
  today: UsageTotals;
  allTime: UsageTotals;
  /** Totals per token plan. Direct API-key requests are grouped separately. */
  byPlan: UsageGroup[];
  /** Most used models, highest token count first. */
  topModels: UsageGroup[];
  firstTimestamp: number | undefined;
  lastTimestamp: number | undefined;
}

/** Label used for requests that are not covered by a token plan. */
export const DIRECT_ACCESS_LABEL = "No plan (direct API key)";

// ── Aggregation ──────────────────────────────────────

/** Create a zeroed totals object. */
export function emptyUsageTotals(): UsageTotals {
  return { requests: 0, promptTokens: 0, completionTokens: 0, totalTokens: 0 };
}

/**
 * Start of the local calendar day containing `timestamp`.
 *
 * Uses the machine's local timezone so "today" matches the user's clock —
 * `consumption.timestamp` is a local `Date.now()` value.
 */
export function startOfLocalDay(timestamp: number): number {
  const date = new Date(timestamp);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

/** Sum a set of records. */
export function sumUsage(records: readonly TokenConsumption[]): UsageTotals {
  const totals = emptyUsageTotals();
  for (const record of records) {
    totals.requests += 1;
    totals.promptTokens += record.promptTokens;
    totals.completionTokens += record.completionTokens;
    totals.totalTokens += record.totalTokens;
  }
  return totals;
}

function groupBy(
  records: readonly TokenConsumption[],
  keyOf: (record: TokenConsumption) => string,
  labelOf: (key: string) => string,
): UsageGroup[] {
  const groups = new Map<string, UsageTotals>();
  for (const record of records) {
    const key = keyOf(record);
    let totals = groups.get(key);
    if (!totals) {
      totals = emptyUsageTotals();
      groups.set(key, totals);
    }
    totals.requests += 1;
    totals.promptTokens += record.promptTokens;
    totals.completionTokens += record.completionTokens;
    totals.totalTokens += record.totalTokens;
  }

  return Array.from(groups.entries())
    .map(([key, totals]) => ({ key, label: labelOf(key), totals }))
    .sort((a, b) => b.totals.totalTokens - a.totals.totalTokens);
}

/**
 * Build the summary shown in the status bar and the usage report.
 *
 * @param now Timestamp treated as "now" (injectable for tests).
 * @param topModelLimit How many models to keep in `topModels`.
 */
export function buildUsageSummary(
  records: readonly TokenConsumption[],
  now: number,
  topModelLimit = 5,
): UsageSummary {
  const todayStart = startOfLocalDay(now);

  return {
    today: sumUsage(records.filter((r) => r.timestamp >= todayStart)),
    allTime: sumUsage(records),
    byPlan: groupBy(
      records,
      (r) => r.planId ?? "",
      (key) => (key === "" ? DIRECT_ACCESS_LABEL : key),
    ),
    topModels: groupBy(
      records,
      (r) => r.modelId,
      (key) => key,
    ).slice(0, topModelLimit),
    firstTimestamp: records.length > 0 ? records[0].timestamp : undefined,
    lastTimestamp:
      records.length > 0 ? records[records.length - 1].timestamp : undefined,
  };
}

// ── Formatting ───────────────────────────────────────

function trimTrailingZero(value: string): string {
  return value.endsWith(".0") ? value.slice(0, -2) : value;
}

/**
 * Compact token count: `999`, `1.2K`, `3.4M`.
 *
 * Promotes to the next unit when rounding would otherwise show `1000.0K`.
 */
export function formatTokenCount(tokens: number): string {
  if (!Number.isFinite(tokens) || tokens < 0) {
    return "0";
  }
  if (tokens < 1000) {
    return String(Math.round(tokens));
  }

  const thousands = tokens / 1000;
  if (thousands < 999.95) {
    return `${trimTrailingZero(thousands.toFixed(1))}K`;
  }

  const millions = tokens / 1_000_000;
  if (millions < 999.95) {
    return `${trimTrailingZero(millions.toFixed(1))}M`;
  }

  return `${trimTrailingZero((tokens / 1_000_000_000).toFixed(1))}B`;
}

/** Status bar text: icon, today's tokens, and today's request count. */
export function formatStatusBarText(today: UsageTotals): string {
  return `$(pulse) ${formatTokenCount(today.totalTokens)} tok · ${today.requests} req`;
}

/**
 * Markdown lines for the status bar tooltip.
 *
 * `now` is used to format the local time of the last recorded request.
 */
export function buildStatusBarTooltip(
  summary: UsageSummary,
  now: number,
): string[] {
  const lines = [
    "**Token Usage**",
    "",
    `Today: ${formatTokenCount(summary.today.totalTokens)} tokens in ${summary.today.requests} request(s)`,
    `  · prompt ${formatTokenCount(summary.today.promptTokens)} / completion ${formatTokenCount(summary.today.completionTokens)}`,
    `All time: ${formatTokenCount(summary.allTime.totalTokens)} tokens in ${summary.allTime.requests} request(s)`,
  ];

  if (summary.lastTimestamp !== undefined) {
    const last = new Date(summary.lastTimestamp);
    const today = summary.lastTimestamp >= startOfLocalDay(now);
    lines.push(
      `Last request: ${today ? last.toLocaleTimeString() : last.toLocaleString()}`,
    );
  }

  lines.push("", "Click for details");
  return lines;
}

function describeTotals(totals: UsageTotals): string {
  return `${formatTokenCount(totals.totalTokens)} tok · ${totals.requests} req`;
}

/**
 * Multi-line report shown by `Copilot Models: Show Token Usage`.
 *
 * @param retentionLimit Record cap, surfaced so "all time" is not mistaken
 * for a lifetime total when older entries have been dropped.
 */
export function formatUsageReport(
  summary: UsageSummary,
  retentionLimit?: number,
): string {
  const lines = [
    `Today: ${describeTotals(summary.today)}`,
    `  prompt ${formatTokenCount(summary.today.promptTokens)} · completion ${formatTokenCount(summary.today.completionTokens)}`,
    "",
    `All time: ${describeTotals(summary.allTime)}`,
    `  prompt ${formatTokenCount(summary.allTime.promptTokens)} · completion ${formatTokenCount(summary.allTime.completionTokens)}`,
  ];

  if (summary.byPlan.length > 0) {
    lines.push("", "By plan:");
    for (const group of summary.byPlan) {
      lines.push(`  ${group.label}: ${describeTotals(group.totals)}`);
    }
  }

  if (summary.topModels.length > 0) {
    lines.push("", "Top models:");
    for (const group of summary.topModels) {
      lines.push(`  ${group.label}: ${describeTotals(group.totals)}`);
    }
  }

  if (summary.firstTimestamp !== undefined) {
    lines.push(
      "",
      `Window: ${new Date(summary.firstTimestamp).toLocaleString()} → ${new Date(summary.lastTimestamp ?? summary.firstTimestamp).toLocaleString()}`,
    );
  }

  if (retentionLimit !== undefined) {
    lines.push(
      "",
      `Retention: most recent ${retentionLimit} records; older entries are dropped.`,
    );
  }

  return lines.join("\n");
}
