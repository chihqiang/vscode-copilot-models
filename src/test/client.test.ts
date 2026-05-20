import * as assert from 'assert';
import {
	ApiError,
	AuthenticationError,
	PermissionError,
	NotFoundError,
	RateLimitError,
	NetworkError,
	TimeoutError,
	CancelledError,
	PayloadTooLargeError,
	UnsupportedMediaTypeError,
	ServiceUnavailableError,
	ApiMessage,
	ApiToolCall,
	ApiTool,
	ApiRequest,
	ApiUsage,
	StreamCallbacks,
	IApiClient,
} from '../core/client';

suite('API Error Classes', () => {
	test('ApiError should have correct properties', () => {
		const error = new ApiError('Test error', 500, 'test-provider', 'response body');

		assert.strictEqual(error.message, 'Test error');
		assert.strictEqual(error.statusCode, 500);
		assert.strictEqual(error.providerId, 'test-provider');
		assert.strictEqual(error.responseBody, 'response body');
		assert.strictEqual(error.name, 'ApiError');
	});

	test('ApiError should identify client errors', () => {
		const error400 = new ApiError('Bad request', 400, 'test');
		const error404 = new ApiError('Not found', 404, 'test');
		const error500 = new ApiError('Server error', 500, 'test');

		assert.strictEqual(error400.isClientError, true);
		assert.strictEqual(error404.isClientError, true);
		assert.strictEqual(error500.isClientError, false);
	});

	test('ApiError should identify server errors', () => {
		const error500 = new ApiError('Server error', 500, 'test');
		const error503 = new ApiError('Unavailable', 503, 'test');
		const error400 = new ApiError('Bad request', 400, 'test');

		assert.strictEqual(error500.isServerError, true);
		assert.strictEqual(error503.isServerError, true);
		assert.strictEqual(error400.isServerError, false);
	});

	test('AuthenticationError should have correct properties', () => {
		const error = new AuthenticationError('deepseek');

		assert.strictEqual(error.statusCode, 401);
		assert.strictEqual(error.providerId, 'deepseek');
		assert.strictEqual(error.name, 'AuthenticationError');
		assert.ok(error.message.includes('Authentication failed'));
	});

	test('PermissionError should have correct properties', () => {
		const error = new PermissionError('deepseek');

		assert.strictEqual(error.statusCode, 403);
		assert.strictEqual(error.name, 'PermissionError');
		assert.ok(error.message.includes('Permission denied'));
	});

	test('NotFoundError should have correct properties', () => {
		const error = new NotFoundError('resource', 'deepseek');

		assert.strictEqual(error.statusCode, 404);
		assert.strictEqual(error.name, 'NotFoundError');
		assert.ok(error.message.includes('Resource not found'));
	});

	test('RateLimitError should have correct properties', () => {
		const error = new RateLimitError('deepseek', 60);

		assert.strictEqual(error.statusCode, 429);
		assert.strictEqual(error.retryAfter, 60);
		assert.strictEqual(error.name, 'RateLimitError');
		assert.ok(error.message.includes('Rate limit exceeded'));
	});

	test('RateLimitError should work without retryAfter', () => {
		const error = new RateLimitError('deepseek');

		assert.strictEqual(error.retryAfter, undefined);
	});

	test('NetworkError should have correct properties', () => {
		const cause = new Error('Connection failed');
		const error = new NetworkError('Connection failed', 'deepseek', cause);

		assert.strictEqual(error.providerId, 'deepseek');
		assert.strictEqual(error.cause, cause);
		assert.strictEqual(error.name, 'NetworkError');
		assert.ok(error.message.includes('Network error'));
	});

	test('TimeoutError should have correct properties', () => {
		const error = new TimeoutError('deepseek', 30000);

		assert.strictEqual(error.providerId, 'deepseek');
		assert.strictEqual(error.timeoutMs, 30000);
		assert.strictEqual(error.name, 'TimeoutError');
		assert.ok(error.message.includes('Request timeout'));
	});

	test('CancelledError should have correct properties', () => {
		const error = new CancelledError('deepseek');

		assert.strictEqual(error.providerId, 'deepseek');
		assert.strictEqual(error.name, 'CancelledError');
		assert.ok(error.message.includes('Request cancelled'));
	});

	test('PayloadTooLargeError should have correct properties', () => {
		const error = new PayloadTooLargeError('deepseek');

		assert.strictEqual(error.statusCode, 413);
		assert.strictEqual(error.name, 'PayloadTooLargeError');
	});

	test('UnsupportedMediaTypeError should have correct properties', () => {
		const error = new UnsupportedMediaTypeError('deepseek');

		assert.strictEqual(error.statusCode, 415);
		assert.strictEqual(error.name, 'UnsupportedMediaTypeError');
	});

	test('ServiceUnavailableError should have correct properties', () => {
		const error = new ServiceUnavailableError('deepseek');

		assert.strictEqual(error.statusCode, 503);
		assert.strictEqual(error.name, 'ServiceUnavailableError');
	});
});

suite('ApiMessage', () => {
	test('should support user role', () => {
		const message: ApiMessage = {
			role: 'user',
			content: 'Hello, world!',
		};

		assert.strictEqual(message.role, 'user');
		assert.strictEqual(message.content, 'Hello, world!');
	});

	test('should support assistant role with tool_calls', () => {
		const message: ApiMessage = {
			role: 'assistant',
			content: 'I will help you',
			tool_calls: [
				{
					id: 'call_123',
					type: 'function',
					function: {
						name: 'get_weather',
						arguments: '{"city":"Beijing"}',
					},
				},
			],
		};

		assert.strictEqual(message.role, 'assistant');
		assert.strictEqual(message.tool_calls?.length, 1);
		assert.strictEqual(message.tool_calls?.[0].function.name, 'get_weather');
	});

	test('should support tool role', () => {
		const message: ApiMessage = {
			role: 'tool',
			content: 'The weather is sunny',
			tool_call_id: 'call_123',
		};

		assert.strictEqual(message.role, 'tool');
		assert.strictEqual(message.tool_call_id, 'call_123');
	});

	test('should support reasoning_content for thinking models', () => {
		const message: ApiMessage = {
			role: 'assistant',
			content: 'Answer',
			reasoning_content: 'Let me think about this...',
		};

		assert.strictEqual(message.reasoning_content, 'Let me think about this...');
	});
});

suite('ApiToolCall', () => {
	test('should have correct structure', () => {
		const toolCall: ApiToolCall = {
			id: 'call_456',
			type: 'function',
			function: {
				name: 'search',
				arguments: '{"query":"test"}',
			},
		};

		assert.strictEqual(toolCall.id, 'call_456');
		assert.strictEqual(toolCall.type, 'function');
		assert.strictEqual(toolCall.function.name, 'search');
		assert.strictEqual(toolCall.function.arguments, '{"query":"test"}');
	});
});

suite('ApiTool', () => {
	test('should have correct structure', () => {
		const tool: ApiTool = {
			type: 'function',
			function: {
				name: 'get_weather',
				description: 'Get weather for a city',
				parameters: {
					type: 'object',
					properties: {
						city: { type: 'string' },
					},
				},
			},
		};

		assert.strictEqual(tool.type, 'function');
		assert.strictEqual(tool.function.name, 'get_weather');
		assert.strictEqual(tool.function.description, 'Get weather for a city');
	});
});

suite('ApiRequest', () => {
	test('should support basic chat request', () => {
		const request: ApiRequest = {
			model: 'deepseek-v4-flash',
			messages: [
				{ role: 'user', content: 'Hello' },
			],
			stream: true,
		};

		assert.strictEqual(request.model, 'deepseek-v4-flash');
		assert.strictEqual(request.messages.length, 1);
		assert.strictEqual(request.stream, true);
	});

	test('should support thinking parameters', () => {
		const request: ApiRequest = {
			model: 'deepseek-v4-flash',
			messages: [{ role: 'user', content: 'Hello' }],
			stream: true,
			thinking: { type: 'enabled' },
			reasoning_effort: 'high',
		};

		assert.strictEqual(request.thinking?.type, 'enabled');
		assert.strictEqual(request.reasoning_effort, 'high');
	});

	test('should support tool configuration', () => {
		const request: ApiRequest = {
			model: 'deepseek-v4-flash',
			messages: [{ role: 'user', content: 'Hello' }],
			stream: true,
			tools: [
				{
					type: 'function',
					function: {
						name: 'get_weather',
						description: 'Get weather for a city',
						parameters: {
							type: 'object',
							properties: {
								city: { type: 'string' },
							},
						},
					},
				},
			],
			tool_choice: 'auto',
		};

		assert.strictEqual(request.tools?.length, 1);
		assert.strictEqual(request.tool_choice, 'auto');
	});
});

suite('ApiUsage', () => {
	test('should have correct structure', () => {
		const usage: ApiUsage = {
			prompt_tokens: 10,
			completion_tokens: 20,
			total_tokens: 30,
		};

		assert.strictEqual(usage.prompt_tokens, 10);
		assert.strictEqual(usage.completion_tokens, 20);
		assert.strictEqual(usage.total_tokens, 30);
	});
});

suite('StreamCallbacks', () => {
	test('should have required callback methods', () => {
		const callbacks: StreamCallbacks = {
			onContent: (content) => {
				assert.strictEqual(typeof content, 'string');
			},
			onThinking: (text) => {
				assert.strictEqual(typeof text, 'string');
			},
			onToolCall: (toolCall) => {
				assert.strictEqual(typeof toolCall.id, 'string');
			},
			onError: (error) => {
				assert.ok(error instanceof Error);
			},
			onDone: () => {},
			onUsage: (usage) => {
				assert.strictEqual(typeof usage.total_tokens, 'number');
			},
		};

		callbacks.onContent('Hello');
		callbacks.onThinking('Thinking...');
		callbacks.onToolCall({
			id: 'call_123',
			type: 'function',
			function: { name: 'test', arguments: '{}' },
		});
		callbacks.onError(new Error('test'));
		callbacks.onDone();
		callbacks.onUsage?.({ prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 });
	});

	test('onUsage callback is optional', () => {
		const callbacks: StreamCallbacks = {
			onContent: () => {},
			onThinking: () => {},
			onToolCall: () => {},
			onError: () => {},
			onDone: () => {},
		};

		assert.strictEqual(callbacks.onUsage, undefined);
	});
});

suite('IApiClient', () => {
	test('should have required properties', () => {
		const client: IApiClient = {
			baseUrl: 'https://api.deepseek.com',
			apiKey: 'sk-test123',
			streamChatCompletion: async () => {},
		};

		assert.strictEqual(client.baseUrl, 'https://api.deepseek.com');
		assert.strictEqual(client.apiKey, 'sk-test123');
		assert.strictEqual(typeof client.streamChatCompletion, 'function');
	});
});