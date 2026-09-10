/**
 * API Client - OpenAI-compatible streaming chat completion client
 *
 * This module defines core types and the API client factory.
 * Implementation details are split into focused modules:
 * - circuit-breaker.ts: Circuit breaker pattern
 * - retry.ts: Exponential backoff retry
 * - errors.ts: API error types
 * - sanitize.ts: Log sanitization
 * - message-convert.ts: Message format conversion
 * - sse.ts: Server-Sent Events streaming
 * - line-decoder.ts: Line-based byte decoding
 * - bytes.ts: UTF-8 encoding/decoding
 */

import type { CancellationToken } from "vscode";
import { logger } from "./logger";
import { CircuitBreaker } from "./circuit-breaker";
import { calculateDelay, delay, parseRetryAfter } from "./retry";
import {
  createApiError,
  classifyError,
  isRetryableError,
  ApiError,
  CancelledError,
  RateLimitError,
  TimeoutError,
} from "./errors";
import { sanitizeForLog, sanitizeUrl } from "./sanitize";
import {
  toChatCompletionMessageParam,
  toChatCompletionTool,
} from "./message-convert";
import { Stream, type ChatCompletionChunk } from "./sse";

// ── Core Types ─────────────────────────────────────────

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
  /** Override base URL (used by token plan) */
  baseUrl?: string | undefined;
  /** Custom API path override (default: /chat/completions) */
  apiPath?: string | undefined;
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
    cancellationToken?: import("vscode").CancellationToken,
  ): Promise<void>;
}

/**
 * API message content part (supports text and images)
 */
export type ContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

/**
 * API message format
 */
export type ApiMessage =
  | {
      role: "tool";
      content: string;
      tool_call_id: string;
    }
  | {
      role: "system" | "user" | "assistant";
      content: string | ContentPart[];
      tool_calls?: ApiToolCall[];
      reasoning_content?: string;
    };

/**
 * API tool call format
 */
export interface ApiToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
}

/**
 * API tool definition format
 */
export interface ApiTool {
  type: "function";
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
  tool_choice?: "none" | "auto" | "required";
  thinking?: { type: "enabled" | "disabled" };
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

export interface ApiClientConfig {
  baseUrl: string;
  apiKey: string;
  providerName: string;
  timeoutMs: number;
  maxRetries: number;
  circuitBreaker?: { failureThreshold?: number; resetTimeoutMs?: number };
  apiPath?: string | undefined;
}

// ── HTTP Utilities ─────────────────────────────────────

/**
 * Upper bound on a server-requested retry delay, so an implausible or
 * erroneous `Retry-After` cannot leave the request hanging for long.
 */
const MAX_RETRY_AFTER_MS = 60_000;

/**
 * Join a base URL and an API path without producing a double slash.
 *
 * A `baseUrl` entered with a trailing slash (e.g. `https://host/v1/`) used to
 * be concatenated verbatim, yielding `https://host/v1//chat/completions` —
 * an empty path segment that some gateways reject with a 404.
 */
export function joinApiUrl(baseUrl: string, apiPath: string): string {
  const base = baseUrl.trim().replace(/\/+$/, "");
  const path = apiPath.trim();
  return path.startsWith("/") ? `${base}${path}` : `${base}/${path}`;
}

/**
 * Send HTTP request and return streaming SSE response.
 *
 * The timeout here only covers connect + response headers — it is cleared as
 * soon as `fetch` resolves. Guarding the streaming phase is the consumer's
 * job; see `ConsumeStreamOptions.idleTimeoutMs` in
 * `consumeChatCompletionStream`.
 */
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
    ? AbortSignal.any([signal, controller.signal])
    : controller.signal;

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
      signal: combinedSignal,
    });
    return response;
  } finally {
    clearTimeout(timeout);
  }
}

async function handleResponseError(
  response: Response,
  providerName: string,
): Promise<never> {
  let errorBody = "";
  try {
    errorBody = await response.text();
  } catch {
    // ignore
  }

  let parsed: Record<string, unknown> = {};
  try {
    parsed = JSON.parse(errorBody) as Record<string, unknown>;
  } catch {
    // ignore
  }

  logger.api.debug(
    `[${providerName}] Response status=${response.status} body=${sanitizeUrl(errorBody.substring(0, 200))}`,
  );

  const parsedError = parsed.error as Record<string, unknown> | undefined;
  const message =
    (parsedError?.message as string) ||
    (parsed.message as string) ||
    errorBody ||
    response.statusText;

  // Surfaced on RateLimitError and honoured by the retry backoff. Read
  // defensively: a Response stand-in may not carry headers.
  const retryAfterMs = parseRetryAfter(
    response.headers?.get?.("retry-after") ?? null,
  );

  throw createApiError(
    response.status,
    providerName,
    message,
    errorBody,
    retryAfterMs,
  );
}

/**
 * Whether a failed request says anything about the provider's health, and so
 * whether it should count toward opening the circuit breaker.
 *
 * The breaker used to count every failure. Because it wraps the whole request
 * (connect, retry and streaming), a misconfigured extension opened it on
 * errors that "the provider is down" does not describe — and once open, the
 * user saw "Circuit breaker OPEN", not the actual problem. A wrong API key was
 * the worst case: the authentication error was swallowed, and since every
 * half-open probe failed the same way, the circuit re-opened forever. The user
 * had a permanent configuration mistake presented as an outage.
 *
 * Counted: timeouts, network errors, 5xx and mid-stream stalls — the provider
 * failing to serve a request it accepted.
 *
 * Not counted:
 * - The caller cancelling. A user pressing stop is not a health signal.
 * - 4xx responses. The provider answered and rejected the request, which means
 *   it is up; a bad key, an unknown model or an oversized payload is a
 *   configuration problem. This includes 429: the retry logic honours the
 *   server's own `Retry-After`, and the router can fail over, both of which are
 *   more precise than blocking every request for the whole reset window.
 */
export function isCountableProviderFailure(
  error: unknown,
  cancellationToken?: CancellationToken,
): boolean {
  if (cancellationToken?.isCancellationRequested) {
    return false;
  }
  if (error instanceof CancelledError) {
    return false;
  }
  if (error instanceof ApiError && error.isClientError) {
    return false;
  }
  return true;
}

// ── API Client Implementation ───────────────────────────

/**
 * Named API client implementation (replaces anonymous IIFE class)
 */
class ApiClientImpl implements IApiClient {
  readonly baseUrl: string;
  readonly apiKey: string;
  private readonly providerName: string;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly circuitBreaker: CircuitBreaker;
  private readonly apiPath: string;

  constructor(config: ApiClientConfig) {
    this.baseUrl = config.baseUrl;
    this.apiKey = config.apiKey;
    this.providerName = config.providerName;
    this.timeoutMs = config.timeoutMs;
    this.maxRetries = config.maxRetries;
    this.circuitBreaker = new CircuitBreaker(config.circuitBreaker);
    this.apiPath = config.apiPath ?? "/chat/completions";

    logger.api.debug(
      `[${this.providerName}] ApiClient created (retry=${this.maxRetries}, circuit=${this.circuitBreaker.getState()})`,
    );
  }

  async streamChatCompletion(
    request: ApiRequest,
    callbacks: StreamCallbacks,
    cancellationToken?: CancellationToken,
  ): Promise<void> {
    const { providerName, circuitBreaker } = this;
    logger.api.info(
      `[${providerName}] Starting streamChatCompletion, model: ${request.model}`,
    );

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

      const extraFields: Record<string, unknown> = {};
      if (request.temperature !== undefined) {
        extraFields.temperature = request.temperature;
      }
      if (request.top_p !== undefined) {
        extraFields.top_p = request.top_p;
      }
      if (request.max_tokens !== undefined) {
        extraFields.max_tokens = request.max_tokens;
      }
      if (tools) {
        extraFields.tools = tools;
      }
      if (request.tool_choice) {
        extraFields.tool_choice = request.tool_choice;
      }

      const requestBody: Record<string, unknown> = {
        model: request.model,
        messages,
        stream: true,
        stream_options: request.stream_options ?? { include_usage: true },
        ...extraFields,
      };

      if (logger.shouldLog("debug")) {
        logger.api.debug(
          `[${providerName}] Request body: ${JSON.stringify(sanitizeForLog(requestBody))}`,
        );
      }

      logger.api.debug(
        `[${providerName}] model="${request.model}" messages=${messages.length} extra=[${Object.keys(extraFields).join(",")}] stream=true`,
      );

      // The circuit breaker now also guards the streaming consumption phase,
      // so mid-stream failures count toward opening the circuit. Retrying is
      // deliberately NOT performed here — a partially streamed response must
      // not be replayed; connect-time retries are handled by sendWithRetry.
      //
      // Failures that say nothing about provider health (a cancelled request,
      // a 4xx) are excluded — see isCountableProviderFailure.
      let streamCompleted = false;
      await circuitBreaker.call(
        providerName,
        async () => {
          const stream = await this.sendWithRetry(
            requestBody,
            controller.signal,
          );
          streamCompleted = await this.consumeStream(
            stream,
            callbacks,
            cancellationToken,
            providerName,
            {
              idleTimeoutMs: this.timeoutMs,
              onIdleTimeout: () => controller.abort(),
            },
          );
        },
        {
          isCountableFailure: (error) =>
            isCountableProviderFailure(error, cancellationToken),
        },
      );

      if (streamCompleted) {
        callbacks.onDone();
      }
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

  /**
   * Consume a streaming response chunk by chunk, dispatching to callbacks.
   * Returns false if the stream was stopped early due to cancellation.
   */
  private consumeStream(
    stream: Stream<ChatCompletionChunk>,
    callbacks: StreamCallbacks,
    cancellationToken: CancellationToken | undefined,
    providerName: string,
    options?: ConsumeStreamOptions,
  ): Promise<boolean> {
    return consumeChatCompletionStream(
      stream,
      callbacks,
      cancellationToken,
      providerName,
      options,
    );
  }

  private async sendWithRetry(
    requestBody: Record<string, unknown>,
    signal: AbortSignal,
  ): Promise<Stream<ChatCompletionChunk>> {
    const { providerName, baseUrl, apiKey, timeoutMs, maxRetries, apiPath } =
      this;

    /** Server-requested delay carried over from the previous failed attempt. */
    let serverRetryAfterMs: number | undefined;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        if (attempt > 0) {
          // Prefer the server's own guidance (Retry-After) over our backoff.
          // Capped so an implausible header cannot stall the request for a
          // long time — beyond that, failing fast beats waiting.
          const backoff =
            serverRetryAfterMs === undefined
              ? calculateDelay(attempt - 1)
              : Math.min(serverRetryAfterMs, MAX_RETRY_AFTER_MS);
          logger.api.warn(
            `[${providerName}] Retry ${attempt}/${maxRetries} after ${backoff}ms${serverRetryAfterMs !== undefined ? " (server Retry-After)" : ""}`,
          );
          // Pass the signal so a user cancellation aborts the backoff
          // immediately instead of waiting for the full delay.
          await delay(backoff, signal);
        }

        const url = joinApiUrl(baseUrl, apiPath);
        logger.api.debug(
          `[${providerName}] POST ${sanitizeUrl(url)}  (apiKey=${apiKey ? "configured" : "missing"})`,
        );

        const response = await fetchStream(
          url,
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
          signal.addEventListener(
            "abort",
            () => streamController.abort(signal.reason),
            { once: true },
          );
        }
        return Stream.fromSSEResponse<ChatCompletionChunk>(
          response,
          streamController,
        );
      } catch (error) {
        if (
          error instanceof RateLimitError &&
          error.retryAfterMs !== undefined
        ) {
          serverRetryAfterMs = error.retryAfterMs;
        }
        if (!isRetryableError(error) || attempt >= maxRetries) {
          throw error;
        }
        logger.api.warn(
          `[${providerName}] Retryable error (${attempt + 1}/${maxRetries + 1}): ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    throw new Error(`Exhausted ${maxRetries + 1} retry attempts`);
  }
}

/**
 * Options controlling how a streaming response is consumed.
 */
export interface ConsumeStreamOptions {
  /**
   * Abort the request when no chunk arrives within this window (ms).
   *
   * The connect timeout used by `fetchStream` is cleared once response headers
   * arrive, so without a stall guard a server that stops sending mid-stream
   * leaves the request hanging until the user cancels manually.
   */
  idleTimeoutMs?: number | undefined;
  /**
   * Invoked when the idle timeout fires, so the caller can abort the
   * underlying HTTP request and release the connection.
   */
  onIdleTimeout?: (() => void) | undefined;
}

/**
 * Await the next iterator result, failing with a `TimeoutError` when nothing
 * arrives within `idleTimeoutMs`.
 */
async function nextChunkWithIdleTimeout<Item>(
  iterator: AsyncIterator<Item>,
  providerName: string,
  options: ConsumeStreamOptions | undefined,
): Promise<IteratorResult<Item>> {
  const pending = iterator.next();
  const idleTimeoutMs = options?.idleTimeoutMs;
  if (!idleTimeoutMs || idleTimeoutMs <= 0) {
    return pending;
  }

  // The aborted request may reject after the timeout already won the race;
  // swallow that so it does not surface as an unhandled rejection.
  pending.catch(() => {});

  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      pending,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          logger.api.error(
            `[${providerName}] Stream stalled: no data for ${idleTimeoutMs}ms, aborting`,
          );
          options?.onIdleTimeout?.();
          reject(new TimeoutError(providerName, idleTimeoutMs));
        }, idleTimeoutMs);
      }),
    ]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

/**
 * Consume an OpenAI-compatible streaming response, dispatching each chunk to
 * the supplied callbacks.
 *
 * Extracted from the client class so the chunk-handling rules are unit
 * testable without a live HTTP stream:
 * - usage arrives in a trailing chunk with an empty `choices` array, so it
 *   must be handled before the choice guard or it is silently dropped;
 * - `delta` may be missing entirely on the final chunk of some gateways;
 * - tool call fragments are accumulated across chunks and flushed either on
 *   finish_reason or, defensively, when the stream ends without one.
 *
 * @returns false when the stream was stopped early due to cancellation.
 */
export async function consumeChatCompletionStream(
  stream: AsyncIterable<ChatCompletionChunk>,
  callbacks: StreamCallbacks,
  cancellationToken: CancellationToken | undefined,
  providerName: string,
  options?: ConsumeStreamOptions,
): Promise<boolean> {
  const pendingToolCalls = new Map<
    number,
    {
      id: string;
      type: "function";
      function: { name: string; arguments: string };
    }
  >();

  /** Emit all accumulated tool calls and reset the buffer. */
  const flushToolCalls = (): void => {
    for (const tc of pendingToolCalls.values()) {
      if (tc.function.name) {
        callbacks.onToolCall({
          id: tc.id,
          type: tc.type,
          function: {
            name: tc.function.name,
            arguments: tc.function.arguments,
          },
        });
      }
    }
    pendingToolCalls.clear();
  };

  logger.api.debug(`[${providerName}] Streaming started`);

  const iterator = stream[Symbol.asyncIterator]();

  while (true) {
    const result = await nextChunkWithIdleTimeout(
      iterator,
      providerName,
      options,
    );
    if (result.done) {
      break;
    }

    const chunk = result.value;

    if (cancellationToken?.isCancellationRequested) {
      logger.api.debug(
        `[${providerName}] Cancellation requested, stopping stream`,
      );
      return false;
    }

    // Usage is delivered in a final chunk whose `choices` array is empty
    // (OpenAI streaming spec), so it must be handled BEFORE the choice guard
    // below — otherwise it is silently dropped and callers relying on usage
    // (e.g. token plan consumption tracking) never fire.
    if (chunk.usage && callbacks.onUsage) {
      callbacks.onUsage({
        prompt_tokens: chunk.usage.prompt_tokens,
        completion_tokens: chunk.usage.completion_tokens,
        total_tokens: chunk.usage.total_tokens,
      });
    }

    const choice = chunk.choices?.[0];
    if (!choice) {
      continue;
    }

    const delta = choice.delta ?? {};

    if (delta.reasoning_content) {
      callbacks.onThinking(delta.reasoning_content);
    }

    if (delta.content) {
      callbacks.onContent(delta.content);
    }

    if (delta.tool_calls) {
      for (const tc of delta.tool_calls) {
        let pending = pendingToolCalls.get(tc.index);
        if (!pending && tc.id) {
          pending = {
            id: tc.id,
            type: "function",
            function: { name: "", arguments: "" },
          };
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

    if (choice.finish_reason) {
      logger.api.debug(
        `[${providerName}] finish_reason="${choice.finish_reason}"`,
      );
      if (choice.finish_reason === "length") {
        logger.api.warn(
          `[${providerName}] Response truncated due to max_tokens limit (finish_reason="length")`,
        );
      }
    }

    if (
      choice.finish_reason === "tool_calls" ||
      choice.finish_reason === "stop"
    ) {
      flushToolCalls();
    }
  }

  // Some gateways end the stream without ever sending a finish_reason.
  // Flush any tool calls accumulated so far instead of dropping them, which
  // would surface to the user as "the model decided to call a tool but
  // nothing happened".
  if (pendingToolCalls.size > 0) {
    logger.api.debug(
      `[${providerName}] Stream ended without finish_reason, flushing ${pendingToolCalls.size} pending tool call(s)`,
    );
    flushToolCalls();
  }

  return true;
}

/**
 * Create an API client instance
 */
export function createApiClient(config: ApiClientConfig): IApiClient {
  return new ApiClientImpl(config);
}
