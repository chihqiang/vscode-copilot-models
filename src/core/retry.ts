import { logger } from './logger';

/**
 * 熔断器状态枚举
 * - CLOSED: 正常状态，请求可以通过
 * - OPEN: 熔断状态，请求被直接拒绝
 * - HALF_OPEN: 半开状态，允许一个探测请求
 */
export enum CircuitState {
  CLOSED,
  OPEN,
  HALF_OPEN,
}

/** 熔断器打开时的错误，请求被阻止 */
export class CircuitBreakerError extends Error {
  constructor(public readonly providerId: string) {
    super(`Circuit breaker OPEN for ${providerId}, request blocked`);
    this.name = 'CircuitBreakerError';
  }
}

/** 熔断器配置 */
export interface CircuitBreakerConfig {
  failureThreshold: number;
  resetTimeoutMs: number;
}

const DEFAULT_CIRCUIT_BREAKER_CONFIG: CircuitBreakerConfig = {
  failureThreshold: 5,
  resetTimeoutMs: 30000,
};

/**
 * 熔断器实现
 * 连续失败达到阈值后断开，经过重置时间后进入半开状态尝试恢复
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

  /** 执行受熔断保护的操作 */
  async call<T>(providerId: string, fn: () => Promise<T>): Promise<T> {
    if (this.state === CircuitState.OPEN) {
      if (Date.now() - this.lastFailureTime >= this.resetTimeoutMs) {
        logger.api.warn(`[${providerId}] Circuit breaker HALF_OPEN, allowing test request`);
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
      this.onFailure(providerId, error);
      throw error;
    }
  }

  /** 成功后重置熔断器 */
  private onSuccess(providerId: string): void {
    if (this.state === CircuitState.HALF_OPEN) {
      logger.api.info(`[${providerId}] Circuit breaker CLOSED (recovered)`);
    }
    this.state = CircuitState.CLOSED;
    this.failureCount = 0;
  }

  /** 失败后记录，达到阈值则打开熔断器 */
  private onFailure(providerId: string, _error: unknown): void {
    this.failureCount++;
    this.lastFailureTime = Date.now();

    if (this.failureCount >= this.failureThreshold) {
      logger.api.warn(`[${providerId}] Circuit breaker OPEN after ${this.failureCount} consecutive failures`);
      this.state = CircuitState.OPEN;
    } else {
      logger.api.debug(`[${providerId}] Circuit breaker failure ${this.failureCount}/${this.failureThreshold}`);
    }
  }

  /** 手动重置熔断器 */
  reset(): void {
    this.state = CircuitState.CLOSED;
    this.failureCount = 0;
    this.lastFailureTime = 0;
  }
}

/** 重试配置 */
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

/** 延时工具函数 */
export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 指数退避计算
 * 每次重试的延迟时间 = min(baseDelay * 2^attempt, maxDelay) + jitter
 */
export function calculateDelay(attempt: number, config?: Partial<RetryConfig>): number {
  const merged = { ...DEFAULT_RETRY_CONFIG, ...config };
  const exponential = Math.min(merged.baseDelayMs * Math.pow(2, attempt), merged.maxDelayMs);
  const jitter = Math.random() * merged.jitterMs;
  return Math.round(exponential + jitter);
}

/** 可重试错误判断函数类型 */
export interface RetryableCheck {
  (error: unknown): boolean;
}
