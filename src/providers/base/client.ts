/**
 * 基础 API 客户端 - 使用 OpenAI SDK 实现
 */

import type {CancellationToken} from 'vscode';
import type {ApiMessage, ApiRequest, ApiTool, StreamCallbacks} from '../../core/interfaces';
import {IApiClient} from '../../core/interfaces';
import {logger} from '../../core/logger';
import OpenAI from 'openai';

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

function toChatCompletionMessageParam(message: ApiMessage): OpenAI.ChatCompletionMessageParam {
    switch (message.role) {
        case 'system':
            return {
                role: 'system',
                content: message.content,
            };
        case 'user':
            return {
                role: 'user',
                content: message.content,
            };
        case 'assistant': {
            const assistantMessage: OpenAI.ChatCompletionAssistantMessageParam = {
                role: 'assistant',
                content: message.content,
            };
            if (message.tool_calls && message.tool_calls.length > 0) {
                assistantMessage.tool_calls = message.tool_calls.map((toolCall) => ({
                    id: toolCall.id,
                    type: toolCall.type,
                    function: {
                        name: toolCall.function.name,
                        arguments: toolCall.function.arguments,
                    },
                }));
            }
            return assistantMessage;
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

function toChatCompletionTool(tool: ApiTool): OpenAI.ChatCompletionTool {
    const toolDefinition: OpenAI.ChatCompletionTool = {
        type: tool.type,
        function: {
            name: tool.function.name,
            ...(tool.function.description ? { description: tool.function.description } : {}),
            ...(tool.function.parameters ? { parameters: tool.function.parameters } : {}),
        },
    };
    return toolDefinition;
}

export interface ApiClientConfig {
    baseUrl: string;
    apiKey: string;
    providerName: string;
    timeoutMs: number;
    maxRetries: number;
}

export function createApiClient(config: ApiClientConfig): IApiClient {
    return new (class implements IApiClient {
        readonly baseUrl: string;
        readonly apiKey: string;
        private readonly providerName: string;
        private readonly timeoutMs: number;
        private readonly openai: OpenAI;

        constructor() {
            this.baseUrl = config.baseUrl;
            this.apiKey = config.apiKey;
            this.providerName = config.providerName;
            this.timeoutMs = config.timeoutMs;
            const maxRetries = config.maxRetries;

            this.openai = new OpenAI({
                apiKey: this.apiKey,
                baseURL: this.baseUrl,
                timeout: this.timeoutMs,
                maxRetries,
            });
            
            logger.api.debug(`[${this.providerName}] ApiClient created with OpenAI SDK`);
        }

        async streamChatCompletion(
            request: ApiRequest,
            callbacks: StreamCallbacks,
            cancellationToken?: CancellationToken,
        ): Promise<void> {
            const {providerName, openai} = this;
            logger.api.info(`[${providerName}] Starting streamChatCompletion, model: ${request.model}`);

            const controller = new AbortController();
            const cancelListener = cancellationToken?.onCancellationRequested(() => {
                logger.api.info(`[${providerName}] Cancellation requested`);
                controller.abort();
            });

            if (cancellationToken?.isCancellationRequested) {
                logger.api.info(`[${providerName}] Already cancelled, aborting`);
                controller.abort();
            }

            try {
                const messages: OpenAI.ChatCompletionMessageParam[] = request.messages.map(toChatCompletionMessageParam);
                const tools: OpenAI.ChatCompletionTool[] | undefined = request.tools?.map(toChatCompletionTool);

                const requestBody: OpenAI.ChatCompletionCreateParamsStreaming = {
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

                logger.api.debug(`[${providerName}] Request body: ${JSON.stringify(sanitizeForLog(requestBody))}`);

                const stream = await openai.chat.completions.create(requestBody, {
                    signal: controller.signal,
                });

                const pendingToolCalls = new Map<number, { id: string; type: 'function'; function: { name: string; arguments: string } }>();

                logger.api.debug(`[${providerName}] Streaming started`);

                for await (const chunk of stream) {
                    if (cancellationToken?.isCancellationRequested) {
                        logger.api.info(`[${providerName}] Cancellation requested, stopping stream`);
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

                logger.api.info(`[${providerName}] Stream completed`);
                callbacks.onDone();
            } catch (error) {
                if (cancellationToken?.isCancellationRequested) {
                    logger.api.info(`[${providerName}] Stream aborted due to cancellation`);
                    callbacks.onError(new CancelledError(providerName));
                    return;
                }

                if (error instanceof Error && error.name === 'AbortError') {
                    logger.api.error(`[${providerName}] Request timeout`);
                    callbacks.onError(new TimeoutError(providerName, this.timeoutMs));
                    return;
                }

                if (error instanceof OpenAI.APIError) {
                    logger.api.error(`[${providerName}] API error (${error.status}): ${error.message}`);
                    callbacks.onError(createApiError(error.status ?? 0, providerName, error.message, error.message));
                    return;
                }

                if (error instanceof TypeError && error.message.includes('fetch')) {
                    logger.api.error(`[${providerName}] Network error:`, error);
                    callbacks.onError(new NetworkError(error.message, providerName, error));
                    return;
                }

                const errorMsg = error instanceof Error ? error : new Error(String(error));
                logger.api.error(`[${providerName}] Stream error:`, errorMsg);
                callbacks.onError(errorMsg);
            } finally {
                cancelListener?.dispose();
            }
        }
    })();
}
