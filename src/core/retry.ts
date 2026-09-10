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
