/**
 * Provider account balance lookup.
 *
 * Only providers with a documented balance API can report a figure — currently
 * DeepSeek (`GET /user/balance`). Zhipu AI, Qwen/DashScope and the Qwen Token
 * Plan endpoint expose no public balance API, so nothing is shown for them.
 *
 * Lookups never throw: a failure is logged at debug level and reported as a
 * reason, so the usage report still renders.
 */

import { logger } from "./logger";
import { sanitizeUrl } from "./sanitize";
import { joinApiUrl } from "./client";
import type { IModelProvider } from "./model-provider";
import { ProviderModels } from "./provider-models";
import { getProviderBaseUrl } from "./settings";

/** How long a balance lookup may take before it is abandoned. */
const BALANCE_TIMEOUT_MS = 10_000;

/**
 * Provider → balance endpoint path.
 *
 * An absent provider has no documented balance API and is skipped entirely.
 */
const BALANCE_PATHS: Record<string, string> = {
  deepseek: "/user/balance",
};

// ── Types ────────────────────────────────────────────

/** A single currency's balance. */
export interface BalanceEntry {
  currency: string;
  totalBalance: string;
  grantedBalance?: string | undefined;
  toppedUpBalance?: string | undefined;
}

/** A provider's balance across currencies. */
export interface ProviderBalance {
  providerId: string;
  /** Whether the balance is still sufficient for API calls. */
  isAvailable: boolean;
  entries: BalanceEntry[];
  fetchedAt: number;
}

/** Why a provider's balance could not be shown. */
export type BalanceUnavailableReason =
  | "not-supported"
  | "not-configured"
  | "request-failed";

export interface ProviderBalanceResult {
  providerId: string;
  balance?: ProviderBalance | undefined;
  reason?: BalanceUnavailableReason | undefined;
}

// ── Capability ───────────────────────────────────────

/** Whether the provider has a documented balance API. */
export function supportsBalance(providerId: string): boolean {
  return providerId in BALANCE_PATHS;
}

/** Providers with a documented balance API, in a stable order. */
export function balanceProviderIds(): string[] {
  return Object.keys(BALANCE_PATHS);
}

// ── Parsing ──────────────────────────────────────────

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * Read the first present string-ish value among `keys`.
 *
 * DeepSeek documents amounts as strings (e.g. `"110.00"`); numbers are accepted
 * too so a gateway returning a JSON number still works. Amounts are kept as
 * strings rather than parsed to numbers to avoid float rounding on currency.
 */
function readAmount(
  source: Record<string, unknown>,
  ...keys: string[]
): string | undefined {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "string" && value.length > 0) {
      return value;
    }
    if (typeof value === "number" && Number.isFinite(value)) {
      return String(value);
    }
  }
  return undefined;
}

/**
 * Parse a DeepSeek `GET /user/balance` response.
 *
 * The documented top-level shape (`is_available` + `balance_infos[]`) is
 * assumed. Inner field names are read tolerantly, preferring the documented
 * snake_case form, because the published schema renders as a table that could
 * not be verified programmatically. Anything unreadable makes this return
 * `undefined` so the caller reports "unavailable" instead of a wrong number.
 */
export function parseDeepSeekBalance(
  payload: unknown,
  providerId: string,
  fetchedAt: number,
): ProviderBalance | undefined {
  if (!isRecord(payload)) {
    return undefined;
  }

  const rawInfos = payload.balance_infos;
  if (!Array.isArray(rawInfos)) {
    return undefined;
  }

  const entries: BalanceEntry[] = [];
  for (const raw of rawInfos) {
    if (!isRecord(raw)) {
      continue;
    }
    const totalBalance = readAmount(raw, "total_balance", "totalBalance");
    if (totalBalance === undefined) {
      continue;
    }
    entries.push({
      currency: readAmount(raw, "currency") ?? "",
      totalBalance,
      grantedBalance: readAmount(raw, "granted_balance", "grantedBalance"),
      toppedUpBalance: readAmount(raw, "topped_up_balance", "toppedUpBalance"),
    });
  }

  if (entries.length === 0) {
    return undefined;
  }

  return {
    providerId,
    // Absent means the provider did not say; assume the account is usable.
    isAvailable: payload.is_available !== false,
    entries,
    fetchedAt,
  };
}

// ── Lookup ───────────────────────────────────────────

/**
 * Query one provider's balance.
 *
 * Never throws — failures are reported through `reason` so the caller can
 * degrade silently.
 */
export async function fetchProviderBalance(
  provider: IModelProvider,
  signal?: AbortSignal,
): Promise<ProviderBalanceResult> {
  const providerId = provider.id;
  const path = BALANCE_PATHS[providerId];
  if (!path) {
    return { providerId, reason: "not-supported" };
  }

  let apiKey: string | undefined;
  try {
    apiKey = await provider.getApiKey();
  } catch (error) {
    logger.auth.debug(
      `[${providerId}] Balance lookup could not read the API key:`,
      error,
    );
  }
  if (!apiKey) {
    logger.auth.debug(`[${providerId}] Balance lookup skipped: no API key`);
    return { providerId, reason: "not-configured" };
  }

  const baseUrl = getProviderBaseUrl(providerId, provider.config.baseUrl);
  const url = joinApiUrl(baseUrl, path);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), BALANCE_TIMEOUT_MS);
  const abortFromCaller = () => controller.abort();
  signal?.addEventListener("abort", abortFromCaller, { once: true });

  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      signal: controller.signal,
    });

    if (!response.ok) {
      logger.auth.debug(
        `[${providerId}] Balance lookup failed: HTTP ${response.status} from ${sanitizeUrl(url)}`,
      );
      return { providerId, reason: "request-failed" };
    }

    const balance = parseDeepSeekBalance(
      await response.json(),
      providerId,
      Date.now(),
    );
    if (!balance) {
      logger.auth.debug(
        `[${providerId}] Balance response had an unexpected shape`,
      );
      return { providerId, reason: "request-failed" };
    }

    logger.auth.debug(
      `[${providerId}] Balance lookup succeeded from ${sanitizeUrl(url)}`,
    );
    return { providerId, balance };
  } catch (error) {
    logger.auth.debug(
      `[${providerId}] Balance lookup failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    return { providerId, reason: "request-failed" };
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", abortFromCaller);
  }
}

/**
 * Look up the balance of every registered provider that supports it.
 * Providers without a balance API are not included.
 */
export async function collectProviderBalances(
  signal?: AbortSignal,
): Promise<ProviderBalanceResult[]> {
  if (!ProviderModels.isInitialized()) {
    return [];
  }

  const registry = ProviderModels.getInstance();
  const results: ProviderBalanceResult[] = [];
  for (const providerId of balanceProviderIds()) {
    const provider = registry.getProvider(providerId);
    if (!provider) {
      continue;
    }
    results.push(await fetchProviderBalance(provider, signal));
  }
  return results;
}

// ── Formatting ───────────────────────────────────────

const CURRENCY_SYMBOLS: Record<string, string> = {
  CNY: "¥",
  USD: "$",
  EUR: "€",
  GBP: "£",
  JPY: "¥",
};

/** Render an amount with its currency, e.g. `¥110.00`. */
export function formatBalanceAmount(amount: string, currency: string): string {
  const symbol = CURRENCY_SYMBOLS[currency.toUpperCase()];
  if (symbol) {
    return `${symbol}${amount}`;
  }
  return currency ? `${amount} ${currency}` : amount;
}

/**
 * Lines for the report's "Balance:" section.
 *
 * Only providers with something worth reporting get a line:
 * - a fetched balance is rendered with its currency breakdown;
 * - a provider that was skipped (no API key, or no balance API) is omitted
 *   entirely — the user is not using it, so a "no API key" line is just noise;
 * - a provider that *is* configured but whose lookup failed shows
 *   `unavailable`, which is the one case the user can act on.
 *
 * Returns an empty array when nothing is reportable, so the caller omits the
 * section header as well.
 */
export function formatBalanceSection(
  results: readonly ProviderBalanceResult[],
): string[] {
  const lines: string[] = [];

  for (const result of results) {
    if (result.balance) {
      const rendered = result.balance.entries.map((entry) => {
        const details: string[] = [];
        if (entry.grantedBalance !== undefined) {
          details.push(
            `granted ${formatBalanceAmount(entry.grantedBalance, entry.currency)}`,
          );
        }
        if (entry.toppedUpBalance !== undefined) {
          details.push(
            `topped up ${formatBalanceAmount(entry.toppedUpBalance, entry.currency)}`,
          );
        }
        const suffix = details.length > 0 ? ` (${details.join(" · ")})` : "";
        return `${formatBalanceAmount(entry.totalBalance, entry.currency)}${suffix}`;
      });

      const warning = result.balance.isAvailable
        ? ""
        : " — insufficient for API calls";
      lines.push(`  ${result.providerId}: ${rendered.join(", ")}${warning}`);
      continue;
    }

    // Nothing to report: the provider is unused or has no balance API.
    if (
      result.reason === "not-configured" ||
      result.reason === "not-supported"
    ) {
      continue;
    }

    lines.push(`  ${result.providerId}: unavailable`);
  }

  return lines.length > 0 ? ["Balance:", ...lines] : [];
}
