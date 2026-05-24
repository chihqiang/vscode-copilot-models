import * as assert from 'assert';
import { Registry } from '../../core/registry';
import type { IProviderFactory } from '../../core/registry';

suite('Registry Test Suite', () => {
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
		Registry.getInstance().clear();
	});

	teardown(() => {
		Registry.getInstance().clear();
	});

	test('getInstance returns same instance', () => {
		const instance1 = Registry.getInstance();
		const instance2 = Registry.getInstance();
		assert.strictEqual(instance1, instance2, 'getInstance should return same singleton instance');
	});

	test('resetInstance clears singleton state', () => {
		const instance1 = Registry.getInstance();
		instance1.registerFactory(createMockFactory('factory-reset', 'Factory Reset'));
		assert.strictEqual(instance1.factoryCount, 1);

		Registry._resetInstance();
		assert.strictEqual(Registry._isInitialized(), false);

		const instance2 = Registry.getInstance();
		assert.notStrictEqual(instance1, instance2);
		assert.strictEqual(instance2.factoryCount, 0);
	});

	test('register adds factory to registry', () => {
		const registry = Registry.getInstance();
		const factory = createMockFactory('test-factory', 'Test Factory');

		registry.registerFactory(factory);

		assert.strictEqual(registry.hasFactory('test-factory'), true);
		assert.strictEqual(registry.getFactory('test-factory'), factory);
	});

	test('register prevents duplicate registration', () => {
		const registry = Registry.getInstance();
		const factory1 = createMockFactory('test-factory', 'Test Factory 1');
		const factory2 = createMockFactory('test-factory', 'Test Factory 2');

		registry.registerFactory(factory1);
		registry.registerFactory(factory2);

		// Should keep the first registered factory
		assert.strictEqual(registry.getFactory('test-factory'), factory1);
	});

	test('getEnabledFactories returns only enabled factories', () => {
		const registry = Registry.getInstance();
		const enabledFactory = createMockFactory('enabled', 'Enabled Factory', true);
		const disabledFactory = createMockFactory('disabled', 'Disabled Factory', false);

		registry.registerFactory(enabledFactory);
		registry.registerFactory(disabledFactory);

		const enabledFactories = registry.getEnabledFactories();
		assert.strictEqual(enabledFactories.length, 1);
		assert.strictEqual(enabledFactories[0].providerId, 'enabled');
	});

	test('getAllFactories returns all registered factories', () => {
		const registry = Registry.getInstance();
		const factory1 = createMockFactory('factory-1', 'Factory 1');
		const factory2 = createMockFactory('factory-2', 'Factory 2');

		registry.registerFactory(factory1);
		registry.registerFactory(factory2);

		const allFactories = registry.getAllFactories();
		assert.strictEqual(allFactories.length, 2);
	});

	test('count returns correct number of factories', () => {
		const registry = Registry.getInstance();
		assert.strictEqual(registry.factoryCount, 0);

		registry.registerFactory(createMockFactory('factory-1', 'Factory 1'));
		assert.strictEqual(registry.factoryCount, 1);

		registry.registerFactory(createMockFactory('factory-2', 'Factory 2'));
		assert.strictEqual(registry.factoryCount, 2);
	});

	test('clear removes all factories', () => {
		const registry = Registry.getInstance();
		registry.registerFactory(createMockFactory('factory-1', 'Factory 1'));
		registry.registerFactory(createMockFactory('factory-2', 'Factory 2'));

		assert.strictEqual(registry.factoryCount, 2);

		registry.clear();
		assert.strictEqual(registry.factoryCount, 0);
		assert.strictEqual(registry.hasFactory('factory-1'), false);
	});

	test('getFactory returns undefined for non-existent factory', () => {
		const registry = Registry.getInstance();
		const result = registry.getFactory('non-existent');
		assert.strictEqual(result, undefined);
	});

	test('has returns correct status', () => {
		const registry = Registry.getInstance();
		const factory = createMockFactory('test-factory', 'Test Factory');

		assert.strictEqual(registry.hasFactory('test-factory'), false);

		registry.registerFactory(factory);
		assert.strictEqual(registry.hasFactory('test-factory'), true);
	});
});
