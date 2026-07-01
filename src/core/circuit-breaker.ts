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
  async call<T>(providerId: string, fn: () => Promise<T>): Promise<T> {
    if (this.state === CircuitState.OPEN) {
      if (Date.now() - this.lastFailureTime >= this.resetTimeoutMs) {
        logger.api.warn(
          `[${providerId}] Circuit breaker HALF_OPEN, allowing test request`,
        );
        this.state = CircuitState.HALF_OPEN;
      } else {
        throw new CircuitBreakerError(providerId);
      }
    }

    try {
      const result = await fn();
      this.onSuccess(providerId);
      return result;
    } catch (error) {
      this.onFailure(providerId);
      throw error;
    }
  }

  /** Reset circuit breaker on success */
  private onSuccess(providerId: string): void {
    if (this.state === CircuitState.HALF_OPEN) {
      logger.api.info(`[${providerId}] Circuit breaker CLOSED (recovered)`);
    }
    this.state = CircuitState.CLOSED;
    this.failureCount = 0;
  }

  /** Record failure, open circuit breaker if threshold reached */
  private onFailure(providerId: string): void {
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
  }
}
