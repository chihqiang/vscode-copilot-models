import * as assert from 'assert';
import type {
	ModelDefinition,
	ModelCapabilities,
	ApiMessage,
	ApiToolCall,
	ApiRequest,
	StreamCallbacks,
	IModelProvider,
	IApiClient,
} from '../core';

suite('Interfaces Test Suite', () => {
	suite('ModelDefinition', () => {
		test('should have required fields', () => {
			const model: ModelDefinition = {
				id: 'test-model',
				name: 'Test Model',
				family: 'test',
				version: '1.0',
				detail: 'A test model',
				maxInputTokens: 1000,
				maxOutputTokens: 500,
				capabilities: {
					toolCalling: true,
					imageInput: false,
					thinking: false,
				},
			};

			assert.strictEqual(model.id, 'test-model');
			assert.strictEqual(model.name, 'Test Model');
			assert.strictEqual(model.family, 'test');
			assert.strictEqual(model.capabilities.toolCalling, true);
		});

		test('should support optional requiresThinkingParam', () => {
			const model: ModelDefinition = {
				id: 'test-model',
				name: 'Test Model',
				family: 'test',
				version: '1.0',
				detail: 'A test model',
				maxInputTokens: 1000,
				maxOutputTokens: 500,
				capabilities: {
					toolCalling: true,
					imageInput: false,
					thinking: false,
				},
				requiresThinkingParam: true,
			};

			assert.strictEqual(model.requiresThinkingParam, true);
		});
	});

	suite('ModelCapabilities', () => {
		test('should define toolCalling capability', () => {
			const capabilities: ModelCapabilities = {
				toolCalling: true,
				imageInput: false,
				thinking: false,
			};

			assert.strictEqual(capabilities.toolCalling, true);
			assert.strictEqual(capabilities.imageInput, false);
		});

		test('should define thinking capability', () => {
			const capabilities: ModelCapabilities = {
				toolCalling: false,
				imageInput: false,
				thinking: true,
			};

			assert.strictEqual(capabilities.thinking, true);
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

			// Test callbacks
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
				// onUsage is optional
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

	suite('IModelProvider', () => {
		test('should have required properties', () => {
			const provider: IModelProvider = {
				id: 'deepseek',
				config: {
					vendorId: 'deepseek',
					vendorName: 'DeepSeek',
					baseUrl: 'https://api.deepseek.com',
					apiKeySecretKey: 'secret.apiKey',
				},
				getApiKey: async () => 'sk-test',
				hasApiKey: async () => true,
				promptForApiKey: async () => false,
				deleteApiKey: async () => {},
				getModels: () => [],
				createClient: () => ({ baseUrl: '', apiKey: '' } as never),
			};

			assert.strictEqual(provider.id, 'deepseek');
			assert.strictEqual(provider.config.vendorName, 'DeepSeek');
		});
	});
});
