/**
 * 基础 API 客户端 - SSE 流式 API 客户端的通用实现
 */

import type { CancellationToken } from 'vscode';
import type { ApiRequest, ApiToolCall, StreamCallbacks, StreamChunk } from '../../core/interfaces';
import { IApiClient } from '../../core/interfaces';
import { logger } from '../../core/logger';

/**
 * 默认请求超时时间（毫秒）
 */
const DEFAULT_TIMEOUT_MS = 60_000; // 60 秒

/**
 * 安全地将对象序列化为 JSON，处理循环引用
 */
function safeStringify(obj: unknown): string {
	return JSON.stringify(obj, (_, value) => {
		if (typeof value === 'object' && value !== null && !(value instanceof Array)) {
			// 只有 Map 类型才需要转换（其他对象保持原样）
			if (value instanceof Map) {
				return Object.fromEntries(value);
			}
		}
		return value;
	});
}

/**
 * 深度复制对象并脱敏敏感字段
 */
function sanitizeForLog(obj: unknown): unknown {
	if (typeof obj !== 'object' || obj === null) {
		return obj;
	}

	if (Array.isArray(obj)) {
		return obj.map(sanitizeForLog);
	}

	const result: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
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

/**
 * 判断是否为敏感字段
 */
function isSensitiveKey(key: string): boolean {
	const sensitivePatterns = [
		'api[_-]?key',
		'authorization',
		' bearer',
		'password',
		'token',
		'secret',
	];
	const lowerKey = key.toLowerCase();
	return sensitivePatterns.some((pattern) => lowerKey.includes(pattern.toLowerCase()));
}

/**
 * 判断是否为中止错误
 */
function isAbortError(error: unknown): boolean {
	return error instanceof Error && error.name === 'AbortError';
}

/**
 * 基础 API 客户端实现
 */
export abstract class BaseApiClient implements IApiClient {
	constructor(
		public readonly baseUrl: string,
		public readonly apiKey: string,
	) {
		logger.api.debug(`[${this.getProviderName()}] BaseApiClient created`);
	}

	/**
	 * 获取请求超时时间（子类可重写）
	 */
	protected getTimeoutMs(): number {
		return DEFAULT_TIMEOUT_MS;
	}

	/**
	 * 获取请求头
	 */
	protected getHeaders(): Record<string, string> {
		return {
			'Content-Type': 'application/json',
			Authorization: `Bearer ${this.apiKey}`,
		};
	}

	/**
	 * 获取 API 端点路径 (子类可重写)
	 */
	protected getChatEndpoint(): string {
		return '/chat/completions';
	}

	/**
	 * 流式获取聊天补全
	 */
	async streamChatCompletion(
		request: ApiRequest,
		callbacks: StreamCallbacks,
		cancellationToken?: CancellationToken,
	): Promise<void> {
		const providerName = this.getProviderName();
		const timeoutMs = this.getTimeoutMs();
		logger.api.info(`[${providerName}] Starting streamChatCompletion, model: ${request.model}, timeout: ${timeoutMs}ms`);

		const controller = new AbortController();
		const cancelListener = cancellationToken?.onCancellationRequested(() => {
			logger.api.info(`[${providerName}] Cancellation requested`);
			controller.abort();
		});

		if (cancellationToken?.isCancellationRequested) {
			logger.api.info(`[${providerName}] Already cancelled, aborting`);
			controller.abort();
		}

		// 设置请求超时
		const timeoutId = setTimeout(() => {
			logger.api.warn(`[${providerName}] Request timeout after ${timeoutMs}ms`);
			controller.abort();
		}, timeoutMs);

		try {
			const requestBody = {
				...request,
				stream_options: { include_usage: true },
			};

			// 打印脱敏后的请求体用于调试
			logger.api.debug(`[${providerName}] Request body: ${safeStringify(sanitizeForLog(requestBody))}`);

			const endpoint = `${this.baseUrl}${this.getChatEndpoint()}`;
			logger.api.debug(`[${providerName}] POST ${endpoint}`);

			const response = await fetch(endpoint, {
				method: 'POST',
				headers: this.getHeaders(),
				body: safeStringify(requestBody),
				signal: controller.signal,
			});

			// 请求成功，清除超时
			clearTimeout(timeoutId);

			logger.api.debug(`[${providerName}] Response status: ${response.status}`);

			if (!response.ok) {
				const errorText = await response.text();
				let errorMessage: string;
				try {
					const errorJson = JSON.parse(errorText);
					errorMessage = errorJson.error?.message || errorJson.message || errorText;
				} catch {
					errorMessage = errorText;
				}
				logger.api.error(`[${providerName}] API error (${response.status}): ${errorMessage}`);
				throw new Error(`${providerName} API error (${response.status}): ${errorMessage}`);
			}

			if (!response.body) {
				logger.api.error(`[${providerName}] No response body received`);
				throw new Error('No response body received');
			}

			const reader = response.body.getReader();
			const decoder = new TextDecoder();
			let buffer = '';
			let totalTokensReceived = 0;

			// 按索引累积工具调用增量
			const pendingToolCalls = new Map<number, ApiToolCall>();

			logger.api.debug(`[${providerName}] Streaming started`);

			while (true) {
				if (cancellationToken?.isCancellationRequested) {
					logger.api.info(`[${providerName}] Cancellation requested, stopping stream`);
					controller.abort();
					return;
				}

				const { done, value } = await reader.read();
				if (done) {
					logger.api.debug(`[${providerName}] Stream reader done`);
					break;
				}

				buffer += decoder.decode(value, { stream: true });

				const lines = buffer.split('\n');
				buffer = lines.pop() || '';

				for (const line of lines) {
					const trimmed = line.trim();

					if (!trimmed || trimmed.startsWith(':')) {
						continue;
					}

					if (trimmed === 'data: [DONE]') {
						logger.api.debug(`[${providerName}] Received [DONE] signal`);
						for (const tc of pendingToolCalls.values()) {
							callbacks.onToolCall(tc);
						}
						pendingToolCalls.clear();
						callbacks.onDone();
						return;
					}

					if (!trimmed.startsWith('data: ')) {
						continue;
					}

					const jsonStr = trimmed.slice(6);
					try {
						const chunk = this.parseChunk(jsonStr);

						// 统计 token
						if (chunk.usage) {
							totalTokensReceived++;
							if (totalTokensReceived % 50 === 0) {
								logger.api.debug(`[${providerName}] Received ${totalTokensReceived} chunks`);
							}
						}

						this.processChunk(chunk, callbacks, pendingToolCalls);
					} catch (e) {
						logger.api.warn(`[${providerName}] Failed to parse SSE chunk:`, e);
					}
				}
			}

			logger.api.info(`[${providerName}] Stream completed, total chunks: ${totalTokensReceived}`);
			callbacks.onDone();
		} catch (error) {
			clearTimeout(timeoutId);

			// 检查是否为超时错误
			if (isAbortError(error)) {
				const errMsg = error instanceof Error ? error.message.toLowerCase() : '';
				if (errMsg.includes('timeout') || errMsg.includes('aborted')) {
					if (!cancellationToken?.isCancellationRequested) {
						logger.api.error(`[${providerName}] Request timeout after ${timeoutMs}ms`);
						callbacks.onError(new Error(`${providerName} request timeout`));
					} else {
						logger.api.info(`[${providerName}] Stream aborted due to cancellation`);
					}
					return;
				}
			}

			if (isAbortError(error) && cancellationToken?.isCancellationRequested) {
				logger.api.info(`[${providerName}] Stream aborted due to cancellation`);
				return;
			}

			const errorMsg = error instanceof Error ? error : new Error(String(error));
			logger.api.error(`[${providerName}] Stream error:`, errorMsg);
			callbacks.onError(errorMsg);
		} finally {
			clearTimeout(timeoutId);
			cancelListener?.dispose();
		}
	}

	/**
	 * 解析 SSE chunk (子类可重写以适应不同 API 格式)
	 */
	protected parseChunk(jsonStr: string): StreamChunk {
		return JSON.parse(jsonStr) as StreamChunk;
	}

	/**
	 * 处理解析后的 chunk (子类可重写以处理特殊字段)
	 */
	protected processChunk(
		chunk: StreamChunk,
		callbacks: StreamCallbacks,
		pendingToolCalls: Map<number, ApiToolCall>,
	): void {
		// 捕获使用统计
		if (chunk.usage && callbacks.onUsage) {
			callbacks.onUsage(chunk.usage);
		}

		const choice = chunk.choices?.[0];
		if (!choice) {
			return;
		}

		// 思考内容
		const reasoning = choice.delta.reasoning_content;
		if (reasoning) {
			callbacks.onThinking(reasoning);
		}

		// 普通内容
		if (choice.delta.content) {
			callbacks.onContent(choice.delta.content);
		}

		// 工具调用
		if (choice.delta.tool_calls) {
			for (const tc of choice.delta.tool_calls) {
				let pending = pendingToolCalls.get(tc.index);
				if (!pending && tc.id) {
					pending = {
						id: tc.id,
						type: 'function',
						function: { name: '', arguments: '' },
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

		// 完成时刷新待处理的工具调用
		if (choice.finish_reason === 'tool_calls' || choice.finish_reason === 'stop') {
			for (const tc of pendingToolCalls.values()) {
				callbacks.onToolCall(tc);
			}
			pendingToolCalls.clear();
		}
	}

	/**
	 * 获取提供商名称 (用于错误消息)
	 */
	protected abstract getProviderName(): string;
}
