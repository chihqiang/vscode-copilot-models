/**
 * Base API Client - Using local OpenAI-compatible implementation
 */

import type {CancellationToken} from 'vscode';
import {logger, shouldLog} from './logger';

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
    this.name = 'CircuitBreakerError';
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

  /** Reset circuit breaker on success */
  private onSuccess(providerId: string): void {
    if (this.state === CircuitState.HALF_OPEN) {
      logger.api.info(`[${providerId}] Circuit breaker CLOSED (recovered)`);
    }
    this.state = CircuitState.CLOSED;
    this.failureCount = 0;
  }

  /** Record failure, open circuit breaker if threshold reached */
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

  /** Manually reset circuit breaker */
  reset(): void {
    this.state = CircuitState.CLOSED;
    this.failureCount = 0;
    this.lastFailureTime = 0;
  }
}

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
      reject(new DOMException('Aborted', 'AbortError'));
      return;
    }
    const timer = setTimeout(resolve, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException('Aborted', 'AbortError'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * Exponential backoff calculation
 * Delay per retry = min(baseDelay * 2^attempt, maxDelay) + jitter
 */
export function calculateDelay(attempt: number, config?: Partial<RetryConfig>): number {
  const merged = { ...DEFAULT_RETRY_CONFIG, ...config };
  const exponential = Math.min(merged.baseDelayMs * Math.pow(2, attempt), merged.maxDelayMs);
  const jitter = Math.random() * merged.jitterMs;
  return Math.round(exponential + jitter);
}

/** Retryable error check function type */
export interface RetryableCheck {
  (error: unknown): boolean;
}

/** Streaming chat completion response chunk */
export interface ChatCompletionChunk {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: Array<{
    index: number;
    delta: {
      content?: string | null;
      reasoning_content?: string;
      tool_calls?: Array<{
        index: number;
        id?: string;
        type?: string;
        function?: { name?: string; arguments?: string };
      }>;
    };
    finish_reason: string | null;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

/**
 * Client configuration options
 */
export interface ClientOptions {
	/** API request timeout (milliseconds) */
	timeoutMs?: number;
	/** Maximum retry count */
	maxRetries?: number;
	/** Circuit breaker configuration */
	circuitBreaker?: { failureThreshold?: number; resetTimeoutMs?: number };
}


/**
 * API client interface
 */
export interface IApiClient {
	/** Base URL */
	readonly baseUrl: string;
	/** API key */
	readonly apiKey: string;
	/** Send streaming chat completion request */
	streamChatCompletion(
		request: ApiRequest,
		callbacks: StreamCallbacks,
		cancellationToken?: import('vscode').CancellationToken,
	): Promise<void>;
}


/**
 * API message content part (supports text and images)
 */
export type ContentPart =
	| { type: 'text'; text: string }
	| { type: 'image_url'; image_url: { url: string } };

/**
 * API message format
 */
export type ApiMessage =
	| {
		role: 'tool';
		content: string;
		tool_call_id: string;
	}
	| {
		role: 'system' | 'user' | 'assistant';
		content: string | ContentPart[];
		tool_calls?: ApiToolCall[];
		reasoning_content?: string;
	};

/**
 * API tool call format
 */
export interface ApiToolCall {
	id: string;
	type: 'function';
	function: {
		name: string;
		arguments: string;
	};
}

/**
 * API tool definition format
 */
export interface ApiTool {
	type: 'function';
	function: {
		name: string;
		description?: string;
		parameters?: Record<string, unknown>;
	};
}

/**
 * API token usage statistics
 */
export interface ApiUsage {
	prompt_tokens: number;
	completion_tokens: number;
	total_tokens: number;
	[key: string]: number;
}

/**
 * API request format
 */
export interface ApiRequest {
	model: string;
	messages: ApiMessage[];
	stream: boolean;
	temperature?: number;
	top_p?: number;
	max_tokens?: number;
	tools?: ApiTool[];
	tool_choice?: 'none' | 'auto' | 'required';
	thinking?: { type: 'enabled' | 'disabled' };
	reasoning_effort?: string;
	stream_options?: {
		include_usage: boolean;
	};
	[key: string]: unknown;
}

/**
 * Stream response callbacks
 */
export interface StreamCallbacks {
	onContent: (content: string) => void;
	onThinking: (text: string) => void;
	onToolCall: (toolCall: ApiToolCall) => void;
	onError: (error: Error) => void;
	onDone: () => void;
	onUsage?: (usage: ApiUsage) => void;
}

export class ApiError extends Error {
    constructor(
        message: string,
        public readonly statusCode: number,
        public readonly providerId: string,
        public readonly responseBody?: string,
    ) {
        super(message);
        this.name = 'ApiError';
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
        super(`Authentication failed for ${providerId}. Please check your API key.`, 401, providerId, responseBody);
        this.name = 'AuthenticationError';
    }
}

export class PermissionError extends ApiError {
    constructor(providerId: string, responseBody?: string) {
        super(`Permission denied for ${providerId}. Please check your API permissions.`, 403, providerId, responseBody);
        this.name = 'PermissionError';
    }
}

export class NotFoundError extends ApiError {
    constructor(resource: string, providerId: string, responseBody?: string) {
        super(`Resource not found: ${resource}`, 404, providerId, responseBody);
        this.name = 'NotFoundError';
    }
}

export class RateLimitError extends ApiError {
    constructor(providerId: string, public readonly retryAfter?: number, responseBody?: string) {
        super(
            `Rate limit exceeded for ${providerId}. Please try again later${retryAfter ? ` after ${retryAfter} seconds` : ''}.`,
            429,
            providerId,
            responseBody,
        );
        this.name = 'RateLimitError';
    }
}

export class NetworkError extends Error {
    constructor(
        message: string,
        public readonly providerId: string,
        public readonly cause?: Error,
    ) {
        super(`Network error for ${providerId}: ${message}`);
        this.name = 'NetworkError';
    }
}

export class TimeoutError extends Error {
    constructor(
        public readonly providerId: string,
        public readonly timeoutMs: number,
    ) {
        super(`Request timeout for ${providerId} after ${timeoutMs}ms`);
        this.name = 'TimeoutError';
    }
}

export class CancelledError extends Error {
    constructor(public readonly providerId: string) {
        super(`Request cancelled for ${providerId}`);
        this.name = 'CancelledError';
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
        this.name = 'PayloadTooLargeError';
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
        this.name = 'UnsupportedMediaTypeError';
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
        this.name = 'ServiceUnavailableError';
    }
}

function createApiError(statusCode: number, providerId: string, errorBody: string, responseBody?: string): ApiError {
    switch (statusCode) {
        case 401:
            return new AuthenticationError(providerId, responseBody);
        case 403:
            return new PermissionError(providerId, responseBody);
        case 404:
            return new NotFoundError('API endpoint', providerId, responseBody);
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

function sanitizeForLog(obj: unknown): unknown {
    if (typeof obj !== 'object' || obj === null) {
        return obj;
    }

    if (Array.isArray(obj)) {
        return obj.map(sanitizeForLog);
    }

    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
        if (isSensitiveKey(key)) {
            result[key] = '[REDACTED]';
        } else if (typeof value === 'object' && value !== null) {
            result[key] = sanitizeForLog(value);
        } else {
            result[key] = value;
        }
    }
    return result;
}

function isSensitiveKey(key: string): boolean {
    const sensitivePatterns = ['api[_-]?key', 'authorization', ' bearer', 'password', 'token', 'secret'];
    const lowerKey = key.toLowerCase();
    return sensitivePatterns.some((pattern) => lowerKey.includes(pattern.toLowerCase()));
}

function toChatContent(message: string | ContentPart[]): Record<string, unknown>[] {
	if (typeof message === 'string') {
		return [{ type: 'text', text: message }];
	}
	return message.map((part) => {
		if (part.type === 'text') {
			return { type: 'text', text: part.text };
		}
		return { type: 'image_url', image_url: { url: part.image_url.url } };
	});
}

function toChatCompletionMessageParam(message: ApiMessage): Record<string, unknown> {
	switch (message.role) {
		case 'system':
			return {
				role: 'system',
				content: typeof message.content === 'string'
					? message.content
					: message.content
						.filter((p): p is { type: 'text'; text: string } => p.type === 'text')
						.map((p) => ({ type: 'text', text: p.text })),
			};
		case 'user':
			return {
				role: 'user',
				content: toChatContent(message.content),
			};
		case 'assistant': {
			const msg: Record<string, unknown> = {
				role: 'assistant',
				content: typeof message.content === 'string'
					? message.content
					: message.content
						.filter((p): p is { type: 'text'; text: string } => p.type === 'text')
						.map((p) => ({ type: 'text', text: p.text })),
			};
			if (message.tool_calls && message.tool_calls.length > 0) {
				msg.tool_calls = message.tool_calls.map((toolCall) => ({
					id: toolCall.id,
					type: toolCall.type,
					function: {
						name: toolCall.function.name,
						arguments: toolCall.function.arguments,
					},
				}));
			}
			return msg;
		}
		case 'tool':
			return {
				role: 'tool',
				content: message.content,
				tool_call_id: message.tool_call_id ?? '',
			};
		default:
			throw new Error('Unsupported message role');
	}
}

function toChatCompletionTool(tool: ApiTool): Record<string, unknown> {
    return {
        type: tool.type,
        function: {
            name: tool.function.name,
            ...(tool.function.description ? { description: tool.function.description } : {}),
            ...(tool.function.parameters ? { parameters: tool.function.parameters } : {}),
        },
    };
}

export interface ApiClientConfig {
    baseUrl: string;
    apiKey: string;
    providerName: string;
    timeoutMs: number;
    maxRetries: number;
    circuitBreaker?: { failureThreshold?: number; resetTimeoutMs?: number };
}

function isRetryableError(error: unknown): boolean {
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

function classifyError(error: unknown, providerName: string): Error {
    if (error instanceof CancelledError) {
        return error;
    }
    if (error instanceof CircuitBreakerError) {
        return error;
    }

    if (error instanceof ApiError) {
        return error;
    }

    if (error instanceof Error && error.name === 'AbortError') {
        return new TimeoutError(providerName, 0);
    }

    if (error instanceof TypeError && error.message.includes('fetch')) {
        return new NetworkError(error.message, providerName, error);
    }

    return error instanceof Error ? error : new Error(String(error));
}

/** Send HTTP request and return streaming SSE response */
async function fetchStream(
  url: string,
  apiKey: string,
  body: Record<string, unknown>,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  const combinedSignal = signal
    ? combineAbortSignals(signal, controller.signal)
    : controller.signal;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
      signal: combinedSignal,
    });
    return response;
  } finally {
    clearTimeout(timeout);
  }
}

function combineAbortSignals(...signals: AbortSignal[]): AbortSignal {
  const controller = new AbortController();
  for (const signal of signals) {
    if (signal.aborted) {
      controller.abort(signal.reason);
      return controller.signal;
    }
    signal.addEventListener('abort', () => controller.abort(signal.reason), { once: true });
  }
  return controller.signal;
}

async function handleResponseError(response: Response, providerName: string): Promise<never> {
  let errorBody = '';
  try {
    errorBody = await response.text();
  } catch {
    // ignore
  }

  let parsed: Record<string, any> = {};
  try {
    parsed = JSON.parse(errorBody);
  } catch {
    // ignore
  }

  const message = parsed?.error?.message || parsed?.message || errorBody || response.statusText;
  throw createApiError(response.status, providerName, message, errorBody);
}

export function createApiClient(config: ApiClientConfig): IApiClient {
    return new (class implements IApiClient {
        readonly baseUrl: string;
        readonly apiKey: string;
        private readonly providerName: string;
        private readonly timeoutMs: number;
        private readonly maxRetries: number;
        private readonly circuitBreaker: CircuitBreaker;

        constructor() {
            this.baseUrl = config.baseUrl;
            this.apiKey = config.apiKey;
            this.providerName = config.providerName;
            this.timeoutMs = config.timeoutMs;
            this.maxRetries = config.maxRetries;
            this.circuitBreaker = new CircuitBreaker(config.circuitBreaker);

            logger.api.debug(`[${this.providerName}] ApiClient created (retry=${this.maxRetries}, circuit=${this.circuitBreaker.getState()})`);
        }

        async streamChatCompletion(
            request: ApiRequest,
            callbacks: StreamCallbacks,
            cancellationToken?: CancellationToken,
        ): Promise<void> {
            const {providerName, circuitBreaker} = this;
            logger.api.info(`[${providerName}] Starting streamChatCompletion, model: ${request.model}`);

            const controller = new AbortController();
            const cancelListener = cancellationToken?.onCancellationRequested(() => {
                logger.api.debug(`[${providerName}] Cancellation requested`);
                controller.abort();
            });

            if (cancellationToken?.isCancellationRequested) {
                controller.abort();
            }

            try {
                const messages = request.messages.map(toChatCompletionMessageParam);
                const tools = request.tools?.map(toChatCompletionTool);

                const requestBody: Record<string, unknown> = {
                    model: request.model,
                    messages,
                    stream: true,
                    stream_options: {include_usage: true},
                    ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
                    ...(request.top_p !== undefined ? { top_p: request.top_p } : {}),
                    ...(request.max_tokens !== undefined ? { max_tokens: request.max_tokens } : {}),
                    ...(tools ? { tools } : {}),
                    ...(request.tool_choice ? { tool_choice: request.tool_choice } : {}),
                };

                if (shouldLog('debug')) {
                    logger.api.debug(`[${providerName}] Request body: ${JSON.stringify(sanitizeForLog(requestBody))}`);
                }

                const stream = await circuitBreaker.call(providerName, async () => {
                    return await this.sendWithRetry(requestBody, controller.signal);
                });

                const pendingToolCalls = new Map<number, { id: string; type: 'function'; function: { name: string; arguments: string } }>();

                logger.api.debug(`[${providerName}] Streaming started`);

                for await (const chunk of stream) {
                    if (cancellationToken?.isCancellationRequested) {
                        logger.api.debug(`[${providerName}] Cancellation requested, stopping stream`);
                        return;
                    }

                    const choice = chunk.choices?.[0];
                    if (!choice) {
                        continue;
                    }

                    const delta = choice.delta;

                    if ('reasoning_content' in delta && typeof delta.reasoning_content === 'string' && delta.reasoning_content) {
                        callbacks.onThinking(delta.reasoning_content);
                    }

                    if (delta.content) {
                        callbacks.onContent(delta.content);
                    }

                    if (delta.tool_calls) {
                        for (const tc of delta.tool_calls) {
                            let pending = pendingToolCalls.get(tc.index);
                            if (!pending && tc.id) {
                                pending = { id: tc.id, type: 'function', function: { name: '', arguments: '' } };
                                pendingToolCalls.set(tc.index, pending);
                            }
                            if (pending) {
                                if (tc.function?.name) {
                                    pending.function.name += tc.function.name;
                                }
                                if (tc.function?.arguments) {
                                    pending.function.arguments += tc.function.arguments;
                                }
                            }
                        }
                    }

                    if (choice.finish_reason === 'tool_calls' || choice.finish_reason === 'stop') {
                        for (const tc of pendingToolCalls.values()) {
                            if (tc.function.name) {
                                callbacks.onToolCall({
                                    id: tc.id,
                                    type: tc.type,
                                    function: { name: tc.function.name, arguments: tc.function.arguments },
                                });
                            }
                        }
                        pendingToolCalls.clear();
                    }

                    if (chunk.usage && callbacks.onUsage) {
                        callbacks.onUsage({
                            prompt_tokens: chunk.usage.prompt_tokens,
                            completion_tokens: chunk.usage.completion_tokens,
                            total_tokens: chunk.usage.total_tokens,
                        });
                    }
                }

                callbacks.onDone();
            } catch (error) {
                if (cancellationToken?.isCancellationRequested) {
                    callbacks.onError(new CancelledError(providerName));
                    return;
                }

                const mapped = classifyError(error, providerName);
                logger.api.error(`[${providerName}] Request failed: ${mapped.message}`);
                callbacks.onError(mapped);
            } finally {
                cancelListener?.dispose();
            }
        }

        private async sendWithRetry(
            requestBody: Record<string, unknown>,
            signal: AbortSignal,
        ): Promise<Stream<ChatCompletionChunk>> {
            const {providerName, baseUrl, apiKey, timeoutMs, maxRetries} = this;

            for (let attempt = 0; attempt <= maxRetries; attempt++) {
                try {
                    if (attempt > 0) {
                        const backoff = calculateDelay(attempt - 1);
                        logger.api.warn(`[${providerName}] Retry ${attempt}/${maxRetries} after ${backoff}ms`);
                        await delay(backoff);
                    }

                    const response = await fetchStream(
                        `${baseUrl}/chat/completions`,
                        apiKey,
                        requestBody,
                        timeoutMs,
                        signal,
                    );

                    if (!response.ok) {
                        await handleResponseError(response, providerName);
                    }

                    const streamController = new AbortController();
                    if (signal.aborted) {
                        streamController.abort(signal.reason);
                    } else {
                        signal.addEventListener('abort', () => streamController.abort(signal.reason), { once: true });
                    }
                    return Stream.fromSSEResponse<ChatCompletionChunk>(response, streamController);
                } catch (error) {
                    if (!isRetryableError(error) || attempt >= maxRetries) {
                        throw error;
                    }
                    logger.api.warn(`[${providerName}] Retryable error (${attempt + 1}/${maxRetries + 1}): ${error instanceof Error ? error.message : String(error)}`);
                }
            }

            throw new Error(`Exhausted ${maxRetries + 1} retry attempts`);
        }
    })();
}

// ── Byte Utilities ──────────────────────────────────────

/** Merge multiple Uint8Arrays */
export function concatBytes(buffers: Uint8Array[]): Uint8Array {
  let length = 0;
  for (const buffer of buffers) {
    length += buffer.length;
  }
  const output = new Uint8Array(length);
  let index = 0;
  for (const buffer of buffers) {
    output.set(buffer, index);
    index += buffer.length;
  }
  return output;
}

let encodeUTF8_: (str: string) => Uint8Array;
/** Encode string to UTF-8 Uint8Array (lazy TextEncoder creation) */
export function encodeUTF8(str: string): Uint8Array {
  return (
    encodeUTF8_ ??
    ((encoder) => (encodeUTF8_ = encoder.encode.bind(encoder)))(new TextEncoder())
  )(str);
}

let decodeUTF8_: (bytes: Uint8Array) => string;
/** Decode UTF-8 Uint8Array to string (lazy TextDecoder creation) */
export function decodeUTF8(bytes: Uint8Array): string {
  return (
    decodeUTF8_ ??
    ((decoder) => (decodeUTF8_ = decoder.decode.bind(decoder)))(new TextDecoder())
  )(bytes);
}

// ── Line Decoder ────────────────────────────────────────

export type Bytes = string | ArrayBuffer | Uint8Array | null | undefined;

export class LineDecoder {
  static NEWLINE_CHARS = new Set(['\n', '\r']);
  static NEWLINE_REGEXP = /\r\n|[\n\r]/g;

  #buffer: Uint8Array;
  #carriageReturnIndex: number | null;

  constructor() {
    this.#buffer = new Uint8Array();
    this.#carriageReturnIndex = null;
  }

  decode(chunk: Bytes): string[] {
    if (chunk === null || chunk === undefined) {
      return [];
    }

    const binaryChunk =
      chunk instanceof ArrayBuffer ? new Uint8Array(chunk)
      : typeof chunk === 'string' ? encodeUTF8(chunk)
      : chunk;

    this.#buffer = concatBytes([this.#buffer, binaryChunk]);

    const lines: string[] = [];
    let patternIndex;
    while ((patternIndex = findNewlineIndex(this.#buffer, this.#carriageReturnIndex)) !== null) {
      if (patternIndex.carriage && this.#carriageReturnIndex === null) {
        this.#carriageReturnIndex = patternIndex.index;
        continue;
      }

      if (
        this.#carriageReturnIndex !== null &&
        (patternIndex.index !== this.#carriageReturnIndex + 1 || patternIndex.carriage)
      ) {
        lines.push(decodeUTF8(this.#buffer.subarray(0, this.#carriageReturnIndex - 1)));
        this.#buffer = this.#buffer.subarray(this.#carriageReturnIndex);
        this.#carriageReturnIndex = null;
        continue;
      }

      const endIndex =
        this.#carriageReturnIndex !== null ? patternIndex.preceding - 1 : patternIndex.preceding;

      const line = decodeUTF8(this.#buffer.subarray(0, endIndex));
      lines.push(line);

      this.#buffer = this.#buffer.subarray(patternIndex.index);
      this.#carriageReturnIndex = null;
    }

    return lines;
  }

  flush(): string[] {
    if (!this.#buffer.length) {
      return [];
    }
    return this.decode('\n');
  }
}

function findNewlineIndex(
  buffer: Uint8Array,
  startIndex: number | null,
): { preceding: number; index: number; carriage: boolean } | null {
  const newline = 0x0a;
  const carriage = 0x0d;

  for (let i = startIndex ?? 0; i < buffer.length; i++) {
    if (buffer[i] === newline) {
      return { preceding: i, index: i + 1, carriage: false };
    }

    if (buffer[i] === carriage) {
      return { preceding: i, index: i + 1, carriage: true };
    }
  }

  return null;
}

export function findDoubleNewlineIndex(buffer: Uint8Array): number {
  const newline = 0x0a;
  const carriage = 0x0d;

  for (let i = 0; i < buffer.length - 1; i++) {
    if (buffer[i] === newline && buffer[i + 1] === newline) {
      return i + 2;
    }
    if (buffer[i] === carriage && buffer[i + 1] === carriage) {
      return i + 2;
    }
    if (
      buffer[i] === carriage &&
      buffer[i + 1] === newline &&
      i + 3 < buffer.length &&
      buffer[i + 2] === carriage &&
      buffer[i + 3] === newline
    ) {
      return i + 4;
    }
  }

  return -1;
}

// ── SSE Stream ──────────────────────────────────────────

export interface ServerSentEvent {
  event: string | null;
  data: string;
  raw: string[];
}

export class Stream<Item> implements AsyncIterable<Item> {
  controller: AbortController;

  constructor(
    private iterator: () => AsyncIterator<Item>,
    controller: AbortController,
  ) {
    this.controller = controller;
  }

  static fromSSEResponse<Item>(response: Response, controller: AbortController): Stream<Item> {
    let consumed = false;

    async function* iterator(): AsyncIterator<Item> {
      if (consumed) {
        throw new Error('Cannot iterate over a consumed stream, use `.tee()` to split the stream.');
      }
      consumed = true;
      let done = false;
      try {
        for await (const sse of _iterSSEMessages(response, controller)) {
          if (done) {continue;}

          if (sse.data.startsWith('[DONE]')) {
            done = true;
            continue;
          }

          if (sse.event === null || !sse.event.startsWith('thread.')) {
            let data: any;
            try {
              data = JSON.parse(sse.data);
            } catch (e) {
              logger.stream.error('Could not parse message into JSON:', sse.data);
              logger.stream.error('From chunk:', sse.raw);
              throw e;
            }

            if (data && data.error) {
              throw new Error(data.error.message || JSON.stringify(data.error));
            }

            yield data as Item;
          } else {
            let data: any;
            try {
              data = JSON.parse(sse.data);
            } catch (e) {
              logger.stream.error('Could not parse message into JSON:', sse.data);
              logger.stream.error('From chunk:', sse.raw);
              throw e;
            }
            if (sse.event === 'error') {
              throw new Error(data.error?.message || data.message || 'Unknown SSE error');
            }
            yield { event: sse.event, data } as any;
          }
        }
        done = true;
      } catch (e) {
        if (isAbortError(e)) {return;}
        throw e;
      } finally {
        if (!done) {controller.abort();}
      }
    }

    return new Stream(iterator, controller);
  }

  [Symbol.asyncIterator](): AsyncIterator<Item> {
    return this.iterator();
  }
}

export async function* _iterSSEMessages(
  response: Response,
  controller: AbortController,
): AsyncGenerator<ServerSentEvent> {
  if (!response.body) {
    controller.abort();
    throw new Error('Attempted to iterate over a response with no body');
  }

  const sseDecoder = new SSEDecoder();
  const lineDecoder = new LineDecoder();
  const iter = readableStreamToAsyncIterable<Uint8Array>(response.body);

  for await (const sseChunk of iterSSEChunks(iter)) {
    for (const line of lineDecoder.decode(sseChunk)) {
      const sse = sseDecoder.decode(line);
      if (sse) {yield sse;}
    }
  }

  for (const line of lineDecoder.flush()) {
    const sse = sseDecoder.decode(line);
    if (sse) {yield sse;}
  }
}

async function* iterSSEChunks(iterator: AsyncIterableIterator<Uint8Array>): AsyncGenerator<Uint8Array> {
  let data = new Uint8Array();

  for await (const chunk of iterator) {
    if (chunk === null || chunk === undefined) {continue;}

    const binaryChunk =
      chunk instanceof ArrayBuffer ? new Uint8Array(chunk)
      : typeof chunk === 'string' ? encodeUTF8(chunk)
      : chunk;

    let newData = new Uint8Array(data.length + binaryChunk.length);
    newData.set(data);
    newData.set(binaryChunk, data.length);
    data = newData;

    let patternIndex;
    while ((patternIndex = findDoubleNewlineIndex(data)) !== -1) {
      yield data.slice(0, patternIndex);
      data = data.subarray(patternIndex);
    }
  }

  if (data.length > 0) {
    yield data;
  }
}

class SSEDecoder {
  private data: string[];
  private event: string | null;
  private chunks: string[];

  constructor() {
    this.event = null;
    this.data = [];
    this.chunks = [];
  }

  decode(line: string) {
    if (line.endsWith('\r')) {
      line = line.substring(0, line.length - 1);
    }

    if (!line) {
      if (!this.event && !this.data.length) {return null;}

      const sse: ServerSentEvent = {
        event: this.event,
        data: this.data.join('\n'),
        raw: this.chunks,
      };

      this.event = null;
      this.data = [];
      this.chunks = [];

      return sse;
    }

    this.chunks.push(line);

    if (line.startsWith(':')) {return null;}

    let [fieldname, _, value] = partition(line, ':');

    if (value.startsWith(' ')) {
      value = value.substring(1);
    }

    if (fieldname === 'event') {
      this.event = value;
    } else if (fieldname === 'data') {
      this.data.push(value);
    }

    return null;
  }
}

function partition(str: string, delimiter: string): [string, string, string] {
  const index = str.indexOf(delimiter);
  if (index !== -1) {
    return [str.substring(0, index), delimiter, str.substring(index + delimiter.length)];
  }
  return [str, '', ''];
}

function readableStreamToAsyncIterable<T>(stream: ReadableStream<T>): AsyncIterableIterator<T> {
  if ((stream as any)[Symbol.asyncIterator]) {return stream as any;}

  const reader = stream.getReader();
  return {
    async next() {
      try {
        const result = await reader.read();
        if (result?.done) {reader.releaseLock();}
        return result;
      } catch (e) {
        reader.releaseLock();
        throw e;
      }
    },
    async return() {
      const cancelPromise = reader.cancel();
      reader.releaseLock();
      await cancelPromise;
      return { done: true, value: undefined as any };
    },
    [Symbol.asyncIterator]() {
      return this;
    },
  };
}

function isAbortError(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    (('name' in err && (err as any).name === 'AbortError') ||
      ('message' in err && String((err as any).message).includes('FetchRequestCanceledException')))
  );
}
