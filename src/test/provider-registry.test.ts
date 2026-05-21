import * as assert from 'assert';
import { ProviderFactoryRegistry } from '../core/provider-registry';
import type { IProviderFactory } from '../core/provider-registry';

suite('ProviderFactoryRegistry Test Suite', () => {
	// Mock Provider Factory
	const createMockFactory = (
		id: string,
		name: string,
		enabled: boolean = true,
	): IProviderFactory => ({
		providerId: id,
		providerName: name,
		isEnabled: () => enabled,
		createChatProvider: () => ({} as never),
	});

	setup(() => {
		ProviderFactoryRegistry.getInstance().clear();
	});

	teardown(() => {
		ProviderFactoryRegistry.getInstance().clear();
	});

	test('getInstance returns same instance', () => {
		const instance1 = ProviderFactoryRegistry.getInstance();
		const instance2 = ProviderFactoryRegistry.getInstance();
		assert.strictEqual(instance1, instance2, 'getInstance should return same singleton instance');
	});

	test('resetInstance clears singleton state', () => {
		const instance1 = ProviderFactoryRegistry.getInstance();
		instance1.register(createMockFactory('factory-reset', 'Factory Reset'));
		assert.strictEqual(instance1.count, 1);

		ProviderFactoryRegistry._resetInstance();
		assert.strictEqual(ProviderFactoryRegistry._isInitialized(), false);

		const instance2 = ProviderFactoryRegistry.getInstance();
		assert.notStrictEqual(instance1, instance2);
		assert.strictEqual(instance2.count, 0);
	});

	test('register adds factory to registry', () => {
		const registry = ProviderFactoryRegistry.getInstance();
		const factory = createMockFactory('test-factory', 'Test Factory');

		registry.register(factory);

		assert.strictEqual(registry.has('test-factory'), true);
		assert.strictEqual(registry.getFactory('test-factory'), factory);
	});

	test('register prevents duplicate registration', () => {
		const registry = ProviderFactoryRegistry.getInstance();
		const factory1 = createMockFactory('test-factory', 'Test Factory 1');
		const factory2 = createMockFactory('test-factory', 'Test Factory 2');

		registry.register(factory1);
		registry.register(factory2);

		// Should keep the first registered factory
		assert.strictEqual(registry.getFactory('test-factory'), factory1);
	});

	test('getEnabledFactories returns only enabled factories', () => {
		const registry = ProviderFactoryRegistry.getInstance();
		const enabledFactory = createMockFactory('enabled', 'Enabled Factory', true);
		const disabledFactory = createMockFactory('disabled', 'Disabled Factory', false);

		registry.register(enabledFactory);
		registry.register(disabledFactory);

		const enabledFactories = registry.getEnabledFactories();
		assert.strictEqual(enabledFactories.length, 1);
		assert.strictEqual(enabledFactories[0].providerId, 'enabled');
	});

	test('getAllFactories returns all registered factories', () => {
		const registry = ProviderFactoryRegistry.getInstance();
		const factory1 = createMockFactory('factory-1', 'Factory 1');
		const factory2 = createMockFactory('factory-2', 'Factory 2');

		registry.register(factory1);
		registry.register(factory2);

		const allFactories = registry.getAllFactories();
		assert.strictEqual(allFactories.length, 2);
	});

	test('count returns correct number of factories', () => {
		const registry = ProviderFactoryRegistry.getInstance();
		assert.strictEqual(registry.count, 0);

		registry.register(createMockFactory('factory-1', 'Factory 1'));
		assert.strictEqual(registry.count, 1);

		registry.register(createMockFactory('factory-2', 'Factory 2'));
		assert.strictEqual(registry.count, 2);
	});

	test('clear removes all factories', () => {
		const registry = ProviderFactoryRegistry.getInstance();
		registry.register(createMockFactory('factory-1', 'Factory 1'));
		registry.register(createMockFactory('factory-2', 'Factory 2'));

		assert.strictEqual(registry.count, 2);

		registry.clear();
		assert.strictEqual(registry.count, 0);
		assert.strictEqual(registry.has('factory-1'), false);
	});

	test('getFactory returns undefined for non-existent factory', () => {
		const registry = ProviderFactoryRegistry.getInstance();
		const result = registry.getFactory('non-existent');
		assert.strictEqual(result, undefined);
	});

	test('has returns correct status', () => {
		const registry = ProviderFactoryRegistry.getInstance();
		const factory = createMockFactory('test-factory', 'Test Factory');

		assert.strictEqual(registry.has('test-factory'), false);

		registry.register(factory);
		assert.strictEqual(registry.has('test-factory'), true);
	});
});
