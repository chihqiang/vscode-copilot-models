/**
 * API error types and error classification utilities
 */

import { CircuitBreakerError } from "./circuit-breaker";

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
    public readonly providerId: string,
  ) {
    super(message);
    this.name = "ApiError";
  }

  get isClientError(): boolean {
    return this.statusCode >= 400 && this.statusCode < 500;
  }

  get isServerError(): boolean {
    return this.statusCode >= 500;
  }
}

export class AuthenticationError extends ApiError {
  constructor(providerId: string) {
    super(
      `Authentication failed for ${providerId}. Please check your API key.`,
      401,
      providerId,
    );
    this.name = "AuthenticationError";
  }
}

export class PermissionError extends ApiError {
  constructor(providerId: string) {
    super(
      `Permission denied for ${providerId}. Please check your API permissions.`,
      403,
      providerId,
    );
    this.name = "PermissionError";
  }
}

export class NotFoundError extends ApiError {
  constructor(resource: string, providerId: string) {
    super(`Resource not found: ${resource}`, 404, providerId);
    this.name = "NotFoundError";
  }
}

export class RateLimitError extends ApiError {
  constructor(
    providerId: string,
    /** Server-requested delay from the `Retry-After` header, in milliseconds. */
    public readonly retryAfterMs?: number,
  ) {
    const hint =
      retryAfterMs === undefined
        ? ""
        : ` Try again in ${Math.max(1, Math.ceil(retryAfterMs / 1000))} second(s).`;
    super(
      `Rate limit exceeded for ${providerId}. Please try again later.${hint}`,
      429,
      providerId,
    );
    this.name = "RateLimitError";
  }
}

export class NetworkError extends Error {
  constructor(
    message: string,
    public readonly providerId: string,
    public readonly cause?: Error,
  ) {
    super(`Network error for ${providerId}: ${message}`);
    this.name = "NetworkError";
  }
}

export class TimeoutError extends Error {
  constructor(
    public readonly providerId: string,
    public readonly timeoutMs: number,
  ) {
    super(`Request timeout for ${providerId} after ${timeoutMs}ms`);
    this.name = "TimeoutError";
  }
}

export class CancelledError extends Error {
  constructor(public readonly providerId: string) {
    super(`Request cancelled for ${providerId}`);
    this.name = "CancelledError";
  }
}

export class PayloadTooLargeError extends ApiError {
  constructor(providerId: string) {
    super(
      `Request payload too large for ${providerId}. Please reduce the input size.`,
      413,
      providerId,
    );
    this.name = "PayloadTooLargeError";
  }
}

export class UnsupportedMediaTypeError extends ApiError {
  constructor(providerId: string) {
    super(
      `Unsupported media type for ${providerId}. Please check the request format.`,
      415,
      providerId,
    );
    this.name = "UnsupportedMediaTypeError";
  }
}

export class ServiceUnavailableError extends ApiError {
  constructor(providerId: string) {
    super(
      `Service temporarily unavailable for ${providerId}. Please try again later.`,
      503,
      providerId,
    );
    this.name = "ServiceUnavailableError";
  }
}

/**
 * Build the error for a non-2xx API response.
 *
 * `message` is the human-readable text to surface, already extracted from the
 * body; `rawBody` is the body as received. The two parameters used to be named
 * `errorBody` and `responseBody` while receiving the opposite of what those
 * names said, so a future reader adding the raw body to a log or message would
 * have picked up the wrong variable.
 */
export function createApiError(
  statusCode: number,
  providerId: string,
  message: string,
  rawBody: string,
  retryAfterMs?: number,
): ApiError {
  switch (statusCode) {
    case 401:
      return new AuthenticationError(providerId);
    case 403:
      return new PermissionError(providerId);
    case 404:
      return new NotFoundError("API endpoint", providerId);
    case 413:
      return new PayloadTooLargeError(providerId);
    case 415:
      return new UnsupportedMediaTypeError(providerId);
    case 429:
      return new RateLimitError(providerId, retryAfterMs);
    case 503:
      return new ServiceUnavailableError(providerId);
    default:
      // The typed errors above carry a fixed, user-facing sentence, so the
      // server's own explanation is only kept for statuses without one.
      return new ApiError(
        `${providerId} API error (${statusCode}): ${message || rawBody}`,
        statusCode,
        providerId,
      );
  }
}

export function isRetryableError(error: unknown): boolean {
  if (error instanceof RateLimitError) {
    return true;
  }
  if (error instanceof ServiceUnavailableError) {
    return true;
  }
  if (error instanceof NetworkError) {
    return true;
  }
  if (error instanceof TimeoutError) {
    return true;
  }
  return false;
}

export function classifyError(error: unknown, providerName: string): Error {
  if (error instanceof CancelledError) {
    return error;
  }
  if (error instanceof CircuitBreakerError) {
    return error;
  }

  if (error instanceof ApiError) {
    return error;
  }

  if (error instanceof Error && error.name === "AbortError") {
    return new CancelledError(providerName);
  }

  if (error instanceof TypeError && error.message.includes("fetch")) {
    return new NetworkError(error.message, providerName, error);
  }

  return error instanceof Error ? error : new Error(String(error));
}
