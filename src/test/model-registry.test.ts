import * as assert from 'assert';
import { ModelRegistry } from '../core/model-registry';
import type { IModelProvider, ModelDefinition } from '../core';

suite('ModelRegistry', () => {
	const testModels: ModelDefinition[] = [
		{
			id: 'test-model-1',
			name: 'Test Model 1',
			family: 'test',
			version: '1.0',
			detail: 'Test model 1',
			maxInputTokens: 1000,
			maxOutputTokens: 500,
			capabilities: { toolCalling: true, imageInput: false, thinking: false },
		},
		{
			id: 'test-model-2',
			name: 'Test Model 2',
			family: 'test',
			version: '2.0',
			detail: 'Test model 2',
			maxInputTokens: 2000,
			maxOutputTokens: 1000,
			capabilities: { toolCalling: false, imageInput: true, thinking: true },
		},
	];

	const createMockProvider = (id: string, models: ModelDefinition[]): IModelProvider => ({
		id,
		config: {
			vendorId: id,
			vendorName: `Test ${id}`,
			baseUrl: `https://api.${id}.com`,
			apiKeySecretKey: `secret.${id}ApiKey`,
		},
		getModels: () => models,
		getApiKey: async () => undefined,
		hasApiKey: async () => false,
		promptForApiKey: async () => false,
		deleteApiKey: async () => {},
		createClient: () => ({ baseUrl: '', apiKey: '' } as never),
	});

	setup(() => {
		ModelRegistry._resetInstance();
	});

	teardown(() => {
		ModelRegistry._resetInstance();
	});

	test('getInstance returns singleton instance', () => {
		const instance1 = ModelRegistry.getInstance();
		const instance2 = ModelRegistry.getInstance();
		assert.strictEqual(instance1, instance2, 'getInstance should return the same singleton instance');
	});

	test('_resetInstance clears singleton state', () => {
		const instance1 = ModelRegistry.getInstance();
		const provider = createMockProvider('test-provider', testModels);
		instance1.registerProvider(provider);
		assert.strictEqual(instance1.hasProviders(), true);

		ModelRegistry._resetInstance();
		assert.strictEqual(ModelRegistry._isInitialized(), false);

		const instance2 = ModelRegistry.getInstance();
		assert.notStrictEqual(instance1, instance2);
		assert.strictEqual(instance2.hasProviders(), false);
	});

	test('registerProvider adds provider and models to registry', () => {
		const registry = ModelRegistry.getInstance();
		const provider = createMockProvider('test-provider', testModels);

		registry.registerProvider(provider);

		assert.strictEqual(registry.getProvider('test-provider'), provider);
		assert.strictEqual(registry.hasProviders(), true);

		const models = registry.getModelsForProvider('test-provider');
		assert.strictEqual(models.length, 2);
		assert.strictEqual(models[0].id, 'test-model-1');
		assert.strictEqual(models[1].id, 'test-model-2');
	});

	test('registerProvider prevents duplicate registration', () => {
		const registry = ModelRegistry.getInstance();
		const provider1 = createMockProvider('test-provider', testModels);
		const provider2 = createMockProvider('test-provider', testModels);

		registry.registerProvider(provider1);
		registry.registerProvider(provider2);

		assert.strictEqual(registry.getProvider('test-provider'), provider1);
	});

	test('unregisterProvider removes provider and its models', () => {
		const registry = ModelRegistry.getInstance();
		const provider = createMockProvider('test-provider', testModels);

		registry.registerProvider(provider);
		assert.strictEqual(registry.hasProviders(), true);
		assert.strictEqual(registry.getModelsForProvider('test-provider').length, 2);

		registry.unregisterProvider('test-provider');
		assert.strictEqual(registry.getProvider('test-provider'), undefined);
		assert.strictEqual(registry.hasProviders(), false);
		assert.strictEqual(registry.getModelsForProvider('test-provider').length, 0);
	});

	test('unregisterProvider handles non-existent provider gracefully', () => {
		const registry = ModelRegistry.getInstance();
		assert.doesNotThrow(() => {
			registry.unregisterProvider('non-existent');
		});
	});

	test('getAllProviders returns all registered providers', () => {
		const registry = ModelRegistry.getInstance();
		const provider1 = createMockProvider('provider-1', [testModels[0]]);
		const provider2 = createMockProvider('provider-2', [testModels[1]]);

		registry.registerProvider(provider1);
		registry.registerProvider(provider2);

		const providers = registry.getAllProviders();
		assert.strictEqual(providers.length, 2);
		assert.ok(providers.includes(provider1));
		assert.ok(providers.includes(provider2));
	});

	test('getAllModels returns all models from all providers', () => {
		const registry = ModelRegistry.getInstance();
		const provider1 = createMockProvider('provider-1', [testModels[0]]);
		const provider2 = createMockProvider('provider-2', [testModels[1]]);

		registry.registerProvider(provider1);
		registry.registerProvider(provider2);

		const allModels = registry.getAllModels();
		assert.strictEqual(allModels.length, 2);
		assert.ok(allModels.some(m => m.id === 'test-model-1'));
		assert.ok(allModels.some(m => m.id === 'test-model-2'));
	});

	test('findModelById finds model across all providers', () => {
		const registry = ModelRegistry.getInstance();
		const provider1 = createMockProvider('provider-1', [testModels[0]]);
		const provider2 = createMockProvider('provider-2', [testModels[1]]);

		registry.registerProvider(provider1);
		registry.registerProvider(provider2);

		const found = registry.findModelById('test-model-2');
		assert.notStrictEqual(found, undefined);
		assert.strictEqual(found?.id, 'test-model-2');
	});

	test('findModelById returns undefined for non-existent model', () => {
		const registry = ModelRegistry.getInstance();
		const found = registry.findModelById('non-existent');
		assert.strictEqual(found, undefined);
	});

	test('findProviderByModelId finds provider by model id', () => {
		const registry = ModelRegistry.getInstance();
		const provider1 = createMockProvider('provider-1', [testModels[0]]);
		const provider2 = createMockProvider('provider-2', [testModels[1]]);

		registry.registerProvider(provider1);
		registry.registerProvider(provider2);

		const found = registry.findProviderByModelId('test-model-2');
		assert.notStrictEqual(found, undefined);
		assert.strictEqual(found?.id, 'provider-2');
	});

	test('findProviderByModelId returns undefined for non-existent model', () => {
		const registry = ModelRegistry.getInstance();
		const found = registry.findProviderByModelId('non-existent');
		assert.strictEqual(found, undefined);
	});

	test('getProvider returns undefined for non-existent provider', () => {
		const registry = ModelRegistry.getInstance();
		const result = registry.getProvider('non-existent');
		assert.strictEqual(result, undefined);
	});

	test('getModelsForProvider returns empty array for non-existent provider', () => {
		const registry = ModelRegistry.getInstance();
		const models = registry.getModelsForProvider('non-existent');
		assert.strictEqual(models.length, 0);
	});

	test('clear removes all providers and models', () => {
		const registry = ModelRegistry.getInstance();
		const provider = createMockProvider('test-provider', testModels);

		registry.registerProvider(provider);
		assert.strictEqual(registry.hasProviders(), true);
		assert.strictEqual(registry.getAllModels().length, 2);

		registry.clear();
		assert.strictEqual(registry.hasProviders(), false);
		assert.strictEqual(registry.getAllModels().length, 0);
	});

	test('hasProviders returns true when providers are registered', () => {
		const registry = ModelRegistry.getInstance();
		assert.strictEqual(registry.hasProviders(), false);

		const provider = createMockProvider('test-provider', testModels);
		registry.registerProvider(provider);

		assert.strictEqual(registry.hasProviders(), true);
	});
});