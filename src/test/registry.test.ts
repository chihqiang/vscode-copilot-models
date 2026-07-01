import * as assert from "assert";
import { ProviderModels } from "../core/provider-models";
import type { IModelProvider, ModelDefinition } from "../core";

suite("Registry Provider Test Suite", () => {
  const testModels: ModelDefinition[] = [
    {
      id: "test-model-1",
      name: "Test Model 1",
      family: "test",
      version: "1.0",
      detail: "Test model 1",
      maxInputTokens: 1000,
      maxOutputTokens: 500,
      capabilities: { toolCalling: true, imageInput: false, thinking: false },
    },
    {
      id: "test-model-2",
      name: "Test Model 2",
      family: "test",
      version: "2.0",
      detail: "Test model 2",
      maxInputTokens: 2000,
      maxOutputTokens: 1000,
      capabilities: { toolCalling: false, imageInput: true, thinking: true },
    },
  ];

  const createMockProvider = (
    id: string,
    models: ModelDefinition[],
  ): IModelProvider => ({
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
    createClient: () => ({ baseUrl: "", apiKey: "" }) as never,
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
    const provider = createMockProvider("test-provider", testModels);
    instance1.registerProvider(provider);
    assert.strictEqual(instance1.hasProviders(), true);

    ProviderModels.resetInstance();
    assert.strictEqual(ProviderModels.isInitialized(), false);

    ProviderModels.init({} as any, []);
    const instance2 = ProviderModels.getInstance();
    assert.notStrictEqual(instance1, instance2);
    assert.strictEqual(instance2.hasProviders(), false);
  });

  test("registerProvider adds provider to registry", () => {
    const pm = ProviderModels.getInstance();
    const provider = createMockProvider("test-provider", testModels);

    pm.registerProvider(provider);

    assert.strictEqual(pm.getProvider("test-provider"), provider);
    assert.strictEqual(pm.hasProviders(), true);
  });

  test("registerProvider adds models to registry", () => {
    const pm = ProviderModels.getInstance();
    const provider = createMockProvider("test-provider", testModels);

    pm.registerProvider(provider);

    const models = pm.getModelsForProvider("test-provider");
    assert.strictEqual(models.length, 2);
    assert.strictEqual(models[0].id, "test-model-1");
    assert.strictEqual(models[1].id, "test-model-2");
  });

  test("registerProvider prevents duplicate registration", () => {
    const pm = ProviderModels.getInstance();
    const provider1 = createMockProvider("test-provider", testModels);
    const provider2 = createMockProvider("test-provider", testModels);

    pm.registerProvider(provider1);
    pm.registerProvider(provider2);

    assert.strictEqual(pm.getProvider("test-provider"), provider1);
  });

  test("unregisterProvider removes provider", () => {
    const pm = ProviderModels.getInstance();
    const provider = createMockProvider("test-provider", testModels);

    pm.registerProvider(provider);
    assert.strictEqual(pm.hasProviders(), true);

    pm.unregisterProvider("test-provider");
    assert.strictEqual(pm.getProvider("test-provider"), undefined);
    assert.strictEqual(pm.hasProviders(), false);
  });

  test("getAllProviders returns all registered providers", () => {
    const pm = ProviderModels.getInstance();
    const provider1 = createMockProvider("provider-1", testModels);
    const provider2 = createMockProvider("provider-2", testModels);

    pm.registerProvider(provider1);
    pm.registerProvider(provider2);

    const providers = pm.getAllProviders();
    assert.strictEqual(providers.length, 2);
  });

  test("getAllModels returns all models from all providers", () => {
    const pm = ProviderModels.getInstance();
    const provider1 = createMockProvider("provider-1", [testModels[0]]);
    const provider2 = createMockProvider("provider-2", [testModels[1]]);

    pm.registerProvider(provider1);
    pm.registerProvider(provider2);

    const allModels = pm.getAllModels();
    assert.strictEqual(allModels.length, 2);
  });

  test("findModelById finds model across all providers", () => {
    const pm = ProviderModels.getInstance();
    const provider1 = createMockProvider("provider-1", [testModels[0]]);
    const provider2 = createMockProvider("provider-2", [testModels[1]]);

    pm.registerProvider(provider1);
    pm.registerProvider(provider2);

    const found = pm.findModelById("test-model-2");
    assert.notStrictEqual(found, undefined);
    assert.strictEqual(found?.id, "test-model-2");
  });

  test("findProviderByModelId finds provider by model id", () => {
    const pm = ProviderModels.getInstance();
    const provider1 = createMockProvider("provider-1", [testModels[0]]);
    const provider2 = createMockProvider("provider-2", [testModels[1]]);

    pm.registerProvider(provider1);
    pm.registerProvider(provider2);

    const found = pm.findProviderByModelId("test-model-2");
    assert.notStrictEqual(found, undefined);
    assert.strictEqual(found?.id, "provider-2");
  });

  test("clear removes all providers and models", () => {
    const pm = ProviderModels.getInstance();
    const provider = createMockProvider("test-provider", testModels);

    pm.registerProvider(provider);
    assert.strictEqual(pm.hasProviders(), true);

    pm.clear();
    assert.strictEqual(pm.hasProviders(), false);
    assert.strictEqual(pm.getAllModels().length, 0);
  });

  test("getProvider returns undefined for non-existent provider", () => {
    const pm = ProviderModels.getInstance();
    const result = pm.getProvider("non-existent");
    assert.strictEqual(result, undefined);
  });

  test("getModelsForProvider returns empty array for non-existent provider", () => {
    const pm = ProviderModels.getInstance();
    const models = pm.getModelsForProvider("non-existent");
    assert.strictEqual(models.length, 0);
  });
});
