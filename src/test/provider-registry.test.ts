import * as assert from "assert";
import { ProviderModels } from "../core/provider-models";
import type { IProviderFactory } from "../core/provider-models";

suite("ProviderModels Factory Test Suite", () => {
  const createMockFactory = (
    id: string,
    name: string,
    enabled: boolean = true,
  ): IProviderFactory => ({
    providerId: id,
    providerName: name,
    isEnabled: () => enabled,
    createChatProvider: () => ({}) as never,
  });

  setup(() => {
    if (ProviderModels.isInitialized()) {
      ProviderModels.getInstance().clear();
    }
  });

  teardown(() => {
    if (ProviderModels.isInitialized()) {
      ProviderModels.getInstance().clear();
    }
  });

  test("getInstance returns same instance", () => {
    ProviderModels.init({} as any, []);
    const instance1 = ProviderModels.getInstance();
    const instance2 = ProviderModels.getInstance();
    assert.strictEqual(
      instance1,
      instance2,
      "getInstance should return same singleton instance",
    );
  });

  test("resetInstance clears singleton state", () => {
    ProviderModels.init({} as any, []);
    const instance1 = ProviderModels.getInstance();
    instance1.registerFactory(
      createMockFactory("factory-reset", "Factory Reset"),
    );
    assert.strictEqual(instance1.factoryCount, 1);

    ProviderModels.resetInstance();
    assert.strictEqual(ProviderModels.isInitialized(), false);

    ProviderModels.init({} as any, []);
    const instance2 = ProviderModels.getInstance();
    assert.notStrictEqual(instance1, instance2);
    assert.strictEqual(instance2.factoryCount, 0);
  });

  test("register adds factory to registry", () => {
    ProviderModels.init({} as any, []);
    const pm = ProviderModels.getInstance();
    const factory = createMockFactory("test-factory", "Test Factory");

    pm.registerFactory(factory);

    assert.strictEqual(pm.hasFactory("test-factory"), true);
    assert.strictEqual(pm.getFactory("test-factory"), factory);
  });

  test("register prevents duplicate registration", () => {
    ProviderModels.init({} as any, []);
    const pm = ProviderModels.getInstance();
    const factory1 = createMockFactory("test-factory", "Test Factory 1");
    const factory2 = createMockFactory("test-factory", "Test Factory 2");

    pm.registerFactory(factory1);
    pm.registerFactory(factory2);

    assert.strictEqual(pm.getFactory("test-factory"), factory1);
  });

  test("getEnabledFactories returns only enabled factories", () => {
    const pm = ProviderModels.getInstance();
    const enabledFactory = createMockFactory(
      "enabled",
      "Enabled Factory",
      true,
    );
    const disabledFactory = createMockFactory(
      "disabled",
      "Disabled Factory",
      false,
    );

    pm.registerFactory(enabledFactory);
    pm.registerFactory(disabledFactory);

    const enabledFactories = pm.getEnabledFactories();
    assert.strictEqual(enabledFactories.length, 1);
    assert.strictEqual(enabledFactories[0].providerId, "enabled");
  });

  test("getAllFactories returns all registered factories", () => {
    const pm = ProviderModels.getInstance();
    const factory1 = createMockFactory("factory-1", "Factory 1");
    const factory2 = createMockFactory("factory-2", "Factory 2");

    pm.registerFactory(factory1);
    pm.registerFactory(factory2);

    const allFactories = pm.getAllFactories();
    assert.strictEqual(allFactories.length, 2);
  });

  test("count returns correct number of factories", () => {
    const pm = ProviderModels.getInstance();
    assert.strictEqual(pm.factoryCount, 0);

    pm.registerFactory(createMockFactory("factory-1", "Factory 1"));
    assert.strictEqual(pm.factoryCount, 1);

    pm.registerFactory(createMockFactory("factory-2", "Factory 2"));
    assert.strictEqual(pm.factoryCount, 2);
  });

  test("clear removes all factories", () => {
    const pm = ProviderModels.getInstance();
    pm.registerFactory(createMockFactory("factory-1", "Factory 1"));
    pm.registerFactory(createMockFactory("factory-2", "Factory 2"));

    assert.strictEqual(pm.factoryCount, 2);

    pm.clear();
    assert.strictEqual(pm.factoryCount, 0);
    assert.strictEqual(pm.hasFactory("factory-1"), false);
  });

  test("getFactory returns undefined for non-existent factory", () => {
    const pm = ProviderModels.getInstance();
    const result = pm.getFactory("non-existent");
    assert.strictEqual(result, undefined);
  });

  test("has returns correct status", () => {
    const pm = ProviderModels.getInstance();
    const factory = createMockFactory("test-factory", "Test Factory");

    assert.strictEqual(pm.hasFactory("test-factory"), false);

    pm.registerFactory(factory);
    assert.strictEqual(pm.hasFactory("test-factory"), true);
  });
});
