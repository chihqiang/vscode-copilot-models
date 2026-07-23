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
import { calculateDelay, delay } from "./retry";
import {
  type ApiError,
  createApiError,
  classifyError,
  isRetryableError,
  CancelledError,
} from "./errors";
import { sanitizeForLog } from "./sanitize";
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
    `[${providerName}] Response status=${response.status} body=${errorBody.substring(0, 200)}`,
  );

  const parsedError = parsed.error as Record<string, unknown> | undefined;
  const message =
    (parsedError?.message as string) ||
    (parsed.message as string) ||
    errorBody ||
    response.statusText;
  throw createApiError(response.status, providerName, message, errorBody);
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

      const stream = await circuitBreaker.call(providerName, async () => {
        return await this.sendWithRetry(requestBody, controller.signal);
      });

      const pendingToolCalls = new Map<
        number,
        {
          id: string;
          type: "function";
          function: { name: string; arguments: string };
        }
      >();

      logger.api.debug(`[${providerName}] Streaming started`);

      for await (const chunk of stream) {
        if (cancellationToken?.isCancellationRequested) {
          logger.api.debug(
            `[${providerName}] Cancellation requested, stopping stream`,
          );
          return;
        }

        const choice = chunk.choices?.[0];
        if (!choice) {
          continue;
        }

        const delta = choice.delta;

        if (
          "reasoning_content" in delta &&
          typeof delta.reasoning_content === "string" &&
          delta.reasoning_content
        ) {
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
    const { providerName, baseUrl, apiKey, timeoutMs, maxRetries, apiPath } =
      this;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        if (attempt > 0) {
          const backoff = calculateDelay(attempt - 1);
          logger.api.warn(
            `[${providerName}] Retry ${attempt}/${maxRetries} after ${backoff}ms`,
          );
          await delay(backoff);
        }

        const url = `${baseUrl}${apiPath}`;
        logger.api.debug(
          `[${providerName}] POST ${url}  (apiKey=${apiKey ? "configured" : "missing"})`,
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
 * Create an API client instance
 */
export function createApiClient(config: ApiClientConfig): IApiClient {
  return new ApiClientImpl(config);
}
