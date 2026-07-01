/**
 * API error types and error classification utilities
 */

import { CircuitBreakerError } from "./circuit-breaker";

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
    public readonly providerId: string,
    public readonly responseBody?: string,
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
  constructor(providerId: string, responseBody?: string) {
    super(
      `Authentication failed for ${providerId}. Please check your API key.`,
      401,
      providerId,
      responseBody,
    );
    this.name = "AuthenticationError";
  }
}

export class PermissionError extends ApiError {
  constructor(providerId: string, responseBody?: string) {
    super(
      `Permission denied for ${providerId}. Please check your API permissions.`,
      403,
      providerId,
      responseBody,
    );
    this.name = "PermissionError";
  }
}

export class NotFoundError extends ApiError {
  constructor(resource: string, providerId: string, responseBody?: string) {
    super(`Resource not found: ${resource}`, 404, providerId, responseBody);
    this.name = "NotFoundError";
  }
}

export class RateLimitError extends ApiError {
  constructor(
    providerId: string,
    public readonly retryAfter?: number,
    responseBody?: string,
  ) {
    super(
      `Rate limit exceeded for ${providerId}. Please try again later${retryAfter ? ` after ${retryAfter} seconds` : ""}.`,
      429,
      providerId,
      responseBody,
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
  constructor(providerId: string, responseBody?: string) {
    super(
      `Request payload too large for ${providerId}. Please reduce the input size.`,
      413,
      providerId,
      responseBody,
    );
    this.name = "PayloadTooLargeError";
  }
}

export class UnsupportedMediaTypeError extends ApiError {
  constructor(providerId: string, responseBody?: string) {
    super(
      `Unsupported media type for ${providerId}. Please check the request format.`,
      415,
      providerId,
      responseBody,
    );
    this.name = "UnsupportedMediaTypeError";
  }
}

export class ServiceUnavailableError extends ApiError {
  constructor(providerId: string, responseBody?: string) {
    super(
      `Service temporarily unavailable for ${providerId}. Please try again later.`,
      503,
      providerId,
      responseBody,
    );
    this.name = "ServiceUnavailableError";
  }
}

export function createApiError(
  statusCode: number,
  providerId: string,
  errorBody: string,
  responseBody?: string,
): ApiError {
  switch (statusCode) {
    case 401:
      return new AuthenticationError(providerId, responseBody);
    case 403:
      return new PermissionError(providerId, responseBody);
    case 404:
      return new NotFoundError("API endpoint", providerId, responseBody);
    case 413:
      return new PayloadTooLargeError(providerId, responseBody);
    case 415:
      return new UnsupportedMediaTypeError(providerId, responseBody);
    case 429:
      return new RateLimitError(providerId, undefined, responseBody);
    case 503:
      return new ServiceUnavailableError(providerId, responseBody);
    default:
      return new ApiError(
        `${providerId} API error (${statusCode}): ${errorBody}`,
        statusCode,
        providerId,
        responseBody,
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
