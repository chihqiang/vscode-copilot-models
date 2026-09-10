/**
 * Retry utilities with exponential backoff
 */

/** Retry configuration */
export interface RetryConfig {
  baseDelayMs: number;
  maxDelayMs: number;
  jitterMs: number;
}

const DEFAULT_RETRY_CONFIG: RetryConfig = {
  baseDelayMs: 1000,
  maxDelayMs: 30000,
  jitterMs: 1000,
};

/** Delay utility function */
export function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }

    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException("Aborted", "AbortError"));
    };

    const timer = setTimeout(() => {
      // Detach the abort listener on the happy path. Retries share a single
      // AbortSignal, so leaving listeners attached accumulates them on the
      // signal and eventually trips Node's MaxListeners warning.
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);

    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/** Month name present in every RFC 9110 HTTP-date form. */
const HTTP_DATE_MONTH =
  /\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\b/i;

/** Time-of-day present in every RFC 9110 HTTP-date form. */
const HTTP_DATE_TIME = /\b\d{1,2}:\d{2}(?::\d{2})?\b/;

/**
 * Parse a `Retry-After` response header into a delay in milliseconds.
 *
 * The header is either a number of seconds or an HTTP date (RFC 9110). Returns
 * undefined when absent or unparseable so callers fall back to exponential
 * backoff. A date in the past yields 0 (retry immediately).
 */
export function parseRetryAfter(
  value: string | null | undefined,
  now: number = Date.now(),
): number | undefined {
  if (!value) {
    return undefined;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }

  // Delay-seconds form.
  if (/^\d+$/.test(trimmed)) {
    return Number(trimmed) * 1000;
  }

  // HTTP-date form. `Date.parse` is far too lenient to be trusted on its own —
  // it happily reads "-5" as a year and "2026" as a date — which would turn a
  // malformed header into "retry immediately". Require the month name and
  // time-of-day that every RFC 9110 date form carries.
  if (!HTTP_DATE_MONTH.test(trimmed) || !HTTP_DATE_TIME.test(trimmed)) {
    return undefined;
  }

  const timestamp = Date.parse(trimmed);
  if (Number.isNaN(timestamp)) {
    return undefined;
  }
  return Math.max(0, timestamp - now);
}

/**
 * Exponential backoff calculation
 * Delay per retry = min(baseDelay * 2^attempt, maxDelay) + jitter
 */
export function calculateDelay(
  attempt: number,
  config?: Partial<RetryConfig>,
): number {
  const merged = { ...DEFAULT_RETRY_CONFIG, ...config };
  const exponential = Math.min(
    merged.baseDelayMs * Math.pow(2, attempt),
    merged.maxDelayMs,
  );
  const jitter = Math.random() * merged.jitterMs;
  return Math.round(exponential + jitter);
}
