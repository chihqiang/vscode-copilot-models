/**
 * Circuit breaker implementation
 * Opens after consecutive failures reach threshold, enters half-open state after reset timeout to attempt recovery
 */

import { logger } from "./logger";

/**
 * Circuit breaker state enum
 * - CLOSED: normal state, requests can pass through
 * - OPEN: circuit open, requests are rejected
 * - HALF_OPEN: half-open state, allows one probe request
 */
export enum CircuitState {
  CLOSED,
  OPEN,
  HALF_OPEN,
}

/** Error thrown when circuit breaker is open, request blocked */
export class CircuitBreakerError extends Error {
  constructor(public readonly providerId: string) {
    super(`Circuit breaker OPEN for ${providerId}, request blocked`);
    this.name = "CircuitBreakerError";
  }
}

/** Circuit breaker configuration */
export interface CircuitBreakerConfig {
  failureThreshold: number;
  resetTimeoutMs: number;
}

/** Per-call options for {@link CircuitBreaker.call}. */
export interface CircuitBreakerCallOptions {
  /**
   * Decide whether a failure counts toward opening the circuit. Defaults to
   * counting every failure.
   *
   * Callers pass a predicate to exclude errors that say nothing about the
   * provider's health — the user cancelling, or a 4xx that means "your request
   * was wrong". Counting those hides the real error behind a circuit-open
   * message and keeps re-opening the circuit on every half-open probe.
   */
  isCountableFailure?: (error: unknown) => boolean;
}

const DEFAULT_CIRCUIT_BREAKER_CONFIG: CircuitBreakerConfig = {
  failureThreshold: 5,
  resetTimeoutMs: 30000,
};

/**
 * Circuit breaker implementation
 * Opens after consecutive failures reach threshold, enters half-open state after reset timeout to attempt recovery
 */
export class CircuitBreaker {
  private state: CircuitState = CircuitState.CLOSED;
  private failureCount = 0;
  private lastFailureTime = 0;
  /** True while the single half-open probe is in flight. */
  private probeInFlight = false;
  private readonly failureThreshold: number;
  private readonly resetTimeoutMs: number;

  constructor(config?: Partial<CircuitBreakerConfig>) {
    const merged = { ...DEFAULT_CIRCUIT_BREAKER_CONFIG, ...config };
    this.failureThreshold = merged.failureThreshold;
    this.resetTimeoutMs = merged.resetTimeoutMs;
  }

  getState(): CircuitState {
    return this.state;
  }

  /** Execute an operation protected by the circuit breaker */
  async call<T>(
    providerId: string,
    fn: () => Promise<T>,
    options?: CircuitBreakerCallOptions,
  ): Promise<T> {
    const isProbe = this.admitRequest(providerId);

    try {
      const result = await fn();
      this.onSuccess(providerId);
      return result;
    } catch (error) {
      this.onFailure(providerId, options?.isCountableFailure?.(error) ?? true);
      throw error;
    } finally {
      // Release the probe slot whichever way the probe went. A rejected
      // request never claimed it (admitRequest threw first).
      if (isProbe) {
        this.probeInFlight = false;
      }
    }
  }

  /**
   * Decide whether a request may proceed, moving the circuit from OPEN to
   * HALF_OPEN once the reset timeout has elapsed.
   *
   * @returns true when this request is the half-open probe, so the caller
   *   knows to release the probe slot when it settles.
   */
  private admitRequest(providerId: string): boolean {
    if (this.state === CircuitState.OPEN) {
      if (Date.now() - this.lastFailureTime < this.resetTimeoutMs) {
        throw new CircuitBreakerError(providerId);
      }
      logger.api.warn(
        `[${providerId}] Circuit breaker HALF_OPEN, allowing one test request`,
      );
      this.state = CircuitState.HALF_OPEN;
    }

    if (this.state === CircuitState.HALF_OPEN) {
      // Exactly one probe at a time. Without this gate the half-open state
      // admitted every concurrent request, so a burst arriving after the
      // reset timeout hit a provider that had not been proven healthy yet —
      // the opposite of what a half-open state is for.
      if (this.probeInFlight) {
        throw new CircuitBreakerError(providerId);
      }
      this.probeInFlight = true;
      return true;
    }

    return false;
  }

  /** Reset circuit breaker on success */
  private onSuccess(providerId: string): void {
    if (this.state === CircuitState.HALF_OPEN) {
      logger.api.info(`[${providerId}] Circuit breaker CLOSED (recovered)`);
    }
    this.state = CircuitState.CLOSED;
    this.failureCount = 0;
  }

  /**
   * Record a failure that reflects provider health, opening the circuit once
   * the threshold is reached.
   *
   * A failed half-open probe reliably re-opens the circuit: the circuit only
   * enters HALF_OPEN once `failureCount` has reached the threshold, and it is
   * never decremented while OPEN, so this increment always crosses it again.
   */
  private onFailure(providerId: string, countable: boolean): void {
    if (!countable) {
      logger.api.debug(
        `[${providerId}] Failure does not reflect provider health, circuit breaker unaffected`,
      );
      return;
    }

    this.failureCount++;
    this.lastFailureTime = Date.now();

    if (this.failureCount >= this.failureThreshold) {
      logger.api.warn(
        `[${providerId}] Circuit breaker OPEN after ${this.failureCount} consecutive failures`,
      );
      this.state = CircuitState.OPEN;
    } else {
      logger.api.debug(
        `[${providerId}] Circuit breaker failure ${this.failureCount}/${this.failureThreshold}`,
      );
    }
  }

  /** Manually reset circuit breaker */
  reset(): void {
    this.state = CircuitState.CLOSED;
    this.failureCount = 0;
    this.lastFailureTime = 0;
    this.probeInFlight = false;
  }
}
