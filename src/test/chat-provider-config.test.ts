/**
 * Regression tests for chat-provider configuration invalidation.
 *
 * API clients are cached per provider and capture their timeout / retry
 * settings at construction time. If a change to those settings does not
 * invalidate the cache, editing them silently has no effect until reload.
 */

import * as assert from "assert";
import * as vscode from "vscode";
import {
  BaseChatProvider,
  clientAffectingConfigKeys,
} from "../core/chat-provider";
import { CONFIG_SECTION, ModelDefinition } from "../core/models";
import type { IModelProvider } from "../core/model-provider";

const PROVIDER = "deepseek";

/** Minimal stand-in for vscode.ConfigurationChangeEvent. */
function createChangeEvent(changedKey: string): {
  affectsConfiguration(section: string): boolean;
} {
  return {
    affectsConfiguration: (section: string) =>
      section === changedKey || changedKey.startsWith(`${section}.`),
  };
}

function createStubProvider(): IModelProvider {
  const models: ModelDefinition[] = [];
  return {
    id: PROVIDER,
    config: {
      vendorId: PROVIDER,
      vendorName: "DeepSeek",
      baseUrl: "https://api.deepseek.com",
      apiKeySecretKey: `${CONFIG_SECTION}.${PROVIDER}.apiKey`,
    },
    getApiKey: async () => undefined,
    hasApiKey: async () => false,
    promptForApiKey: async () => false,
    deleteApiKey: async () => {},
    getModels: () => models,
    createClient: () => ({}) as never,
  };
}

function createStubContext(): vscode.ExtensionContext {
  return {
    globalStorageUri: vscode.Uri.parse("file:///tmp/copilot-models-test"),
    secrets: {
      get: async () => undefined,
      store: async () => {},
      delete: async () => {},
      onDidChange: () => ({ dispose: () => {} }),
    },
    subscriptions: [],
  } as unknown as vscode.ExtensionContext;
}

/** Exposes protected internals so the cache-invalidation wiring is under test. */
class TestableProvider extends BaseChatProvider {
  constructor(context: vscode.ExtensionContext = createStubContext()) {
    super(context, createStubProvider());
  }

  isAffectedBy(e: vscode.ConfigurationChangeEvent): boolean {
    return this.affectsConfiguration(e);
  }

  get visionServiceForTest(): vscode.Disposable {
    return this.visionService;
  }

  /** Seed the client cache the way a completed request would. */
  seedCachedClient(key: string): void {
    this.clientCache.set(key, {} as never);
  }

  cachedClientCount(): number {
    return this.clientCache.size;
  }

  notifySecretChange(key: string): void {
    this.onSecretsChanged({ key } as vscode.SecretStorageChangeEvent);
  }
}

suite("clientAffectingConfigKeys Test Suite", () => {
  test("includes the base URL and model ID overrides", () => {
    const keys = clientAffectingConfigKeys(CONFIG_SECTION, PROVIDER);
    assert.ok(keys.includes(`${CONFIG_SECTION}.${PROVIDER}.baseUrl`));
    assert.ok(keys.includes(`${CONFIG_SECTION}.modelIdOverrides`));
  });

  test("includes the request settings captured at client construction", () => {
    const keys = clientAffectingConfigKeys(CONFIG_SECTION, PROVIDER);
    assert.ok(
      keys.includes(`${CONFIG_SECTION}.timeoutMs`),
      "timeoutMs must invalidate cached clients",
    );
    assert.ok(
      keys.includes(`${CONFIG_SECTION}.maxRetries`),
      "maxRetries must invalidate cached clients",
    );
  });

  test("recognises a timeout change and ignores unrelated providers", () => {
    const keys = clientAffectingConfigKeys(CONFIG_SECTION, PROVIDER);
    const isAffected = (changedKey: string) =>
      keys.some((key) =>
        createChangeEvent(changedKey).affectsConfiguration(key),
      );

    assert.strictEqual(isAffected(`${CONFIG_SECTION}.timeoutMs`), true);
    assert.strictEqual(isAffected(`${CONFIG_SECTION}.maxRetries`), true);
    assert.strictEqual(
      isAffected(`${CONFIG_SECTION}.${PROVIDER}.baseUrl`),
      true,
    );
    assert.strictEqual(isAffected(`${CONFIG_SECTION}.debugMode`), false);
    assert.strictEqual(
      isAffected(`${CONFIG_SECTION}.routingStrategy`),
      false,
      "routing settings are handled by the router, not the client cache",
    );
  });
});

suite("BaseChatProvider.affectsConfiguration Test Suite", () => {
  test("invalidates the client cache when request settings change", () => {
    const provider = new TestableProvider();
    try {
      const affects = (key: string) =>
        provider.isAffectedBy(
          createChangeEvent(key) as vscode.ConfigurationChangeEvent,
        );

      // These are captured when the client is constructed, so the cached
      // client must be dropped when they change.
      assert.strictEqual(affects(`${CONFIG_SECTION}.timeoutMs`), true);
      assert.strictEqual(affects(`${CONFIG_SECTION}.maxRetries`), true);
      assert.strictEqual(
        affects(`${CONFIG_SECTION}.${PROVIDER}.baseUrl`),
        true,
      );
      assert.strictEqual(affects(`${CONFIG_SECTION}.modelIdOverrides`), true);

      // Unrelated settings must not drop the cache.
      assert.strictEqual(affects(`${CONFIG_SECTION}.debugMode`), false);
      assert.strictEqual(affects(`${CONFIG_SECTION}.visionModel`), false);
    } finally {
      provider.dispose();
    }
  });
});

suite("BaseChatProvider secret change Test Suite", () => {
  const apiKeySecret = `${CONFIG_SECTION}.${PROVIDER}.apiKey`;
  test("drops cached API clients when the provider API key is rotated", () => {
    const provider = new TestableProvider();
    try {
      provider.seedCachedClient("https://api.deepseek.com::sk-old");
      assert.strictEqual(provider.cachedClientCount(), 1);

      provider.notifySecretChange(apiKeySecret);

      assert.strictEqual(
        provider.cachedClientCount(),
        0,
        "a rotated API key must not keep the old client cached — the cache key embeds the key",
      );
    } finally {
      provider.dispose();
    }
  });

  test("keeps cached API clients when an unrelated secret changes", () => {
    const provider = new TestableProvider();
    try {
      provider.seedCachedClient("https://api.deepseek.com::sk-old");

      provider.notifySecretChange("some.other.secret");

      assert.strictEqual(
        provider.cachedClientCount(),
        1,
        "unrelated secrets must not thrash the client cache",
      );
    } finally {
      provider.dispose();
    }
  });
});

suite("BaseChatProvider vision service sharing Test Suite", () => {
  /** The private listener list of VisionService, to observe disposal. */
  interface VisionServiceInternals {
    disposables: vscode.Disposable[];
  }

  test("shares one vision service per extension context", () => {
    const context = createStubContext();
    const first = new TestableProvider(context);
    const second = new TestableProvider(context);

    try {
      assert.strictEqual(
        first.visionServiceForTest,
        second.visionServiceForTest,
        "each provider used to build its own VisionService, duplicating its listeners",
      );
      assert.strictEqual(
        context.subscriptions.length,
        1,
        "the shared service must be registered with the extension once",
      );
    } finally {
      first.dispose();
      second.dispose();
    }
  });

  test("keeps contexts isolated", () => {
    const first = new TestableProvider(createStubContext());
    const second = new TestableProvider(createStubContext());

    try {
      assert.notStrictEqual(
        first.visionServiceForTest,
        second.visionServiceForTest,
      );
    } finally {
      first.dispose();
      second.dispose();
    }
  });

  test("disposing one provider does not tear down the shared service", () => {
    const context = createStubContext();
    const disabled = new TestableProvider(context);
    const remaining = new TestableProvider(context);
    const shared = remaining.visionServiceForTest;

    try {
      // Disabling a provider disposes it. The vision service is owned by the
      // extension, so the provider still in use must keep working.
      disabled.dispose();

      assert.strictEqual(
        remaining.visionServiceForTest,
        shared,
        "the shared instance must survive a provider disposal",
      );
      assert.strictEqual(
        (shared as unknown as VisionServiceInternals).disposables.length,
        2,
        "its configuration and secret listeners must still be registered",
      );
    } finally {
      remaining.dispose();
    }
  });
});
