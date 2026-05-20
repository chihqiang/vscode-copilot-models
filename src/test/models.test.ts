import * as assert from 'assert';
import { CONFIG_SECTION, ModelCapabilities, ModelDefinition } from '../core/models';

suite('Models', () => {
	test('CONFIG_SECTION should have correct value', () => {
		assert.strictEqual(CONFIG_SECTION, 'copilot-models');
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
			assert.strictEqual(capabilities.thinking, false);
		});

		test('should define imageInput capability', () => {
			const capabilities: ModelCapabilities = {
				toolCalling: false,
				imageInput: true,
				thinking: false,
			};

			assert.strictEqual(capabilities.imageInput, true);
		});

		test('should define thinking capability', () => {
			const capabilities: ModelCapabilities = {
				toolCalling: false,
				imageInput: false,
				thinking: true,
			};

			assert.strictEqual(capabilities.thinking, true);
		});

		test('should support all capabilities enabled', () => {
			const capabilities: ModelCapabilities = {
				toolCalling: true,
				imageInput: true,
				thinking: true,
			};

			assert.strictEqual(capabilities.toolCalling, true);
			assert.strictEqual(capabilities.imageInput, true);
			assert.strictEqual(capabilities.thinking, true);
		});
	});

	suite('ModelDefinition', () => {
		test('should have all required fields', () => {
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
			assert.strictEqual(model.version, '1.0');
			assert.strictEqual(model.detail, 'A test model');
			assert.strictEqual(model.maxInputTokens, 1000);
			assert.strictEqual(model.maxOutputTokens, 500);
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
					thinking: true,
				},
				requiresThinkingParam: true,
			};

			assert.strictEqual(model.requiresThinkingParam, true);
		});

		test('should work without optional requiresThinkingParam', () => {
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

			assert.strictEqual(model.requiresThinkingParam, undefined);
		});

		test('should handle large token limits', () => {
			const model: ModelDefinition = {
				id: 'large-model',
				name: 'Large Model',
				family: 'test',
				version: '2.0',
				detail: 'A large model',
				maxInputTokens: 128000,
				maxOutputTokens: 64000,
				capabilities: {
					toolCalling: true,
					imageInput: true,
					thinking: true,
				},
			};

			assert.strictEqual(model.maxInputTokens, 128000);
			assert.strictEqual(model.maxOutputTokens, 64000);
		});

		test('should have unique id across models', () => {
			const model1: ModelDefinition = {
				id: 'model-a',
				name: 'Model A',
				family: 'test',
				version: '1.0',
				detail: 'Model A',
				maxInputTokens: 1000,
				maxOutputTokens: 500,
				capabilities: { toolCalling: false, imageInput: false, thinking: false },
			};

			const model2: ModelDefinition = {
				id: 'model-b',
				name: 'Model B',
				family: 'test',
				version: '1.0',
				detail: 'Model B',
				maxInputTokens: 1000,
				maxOutputTokens: 500,
				capabilities: { toolCalling: false, imageInput: false, thinking: false },
			};

			assert.notStrictEqual(model1.id, model2.id);
		});
	});
});