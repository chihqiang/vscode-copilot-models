/**
 * Regression tests for the callbacks VS Code invokes on its own schedule.
 *
 * `provideLanguageModelChatInformation` is not called only when the user opens
 * the picker: VS Code probes it eagerly to keep the model list current, and
 * does so again while the extension is shutting down — after `deactivate()` has
 * run `TokenPlan.resetInstance()`.
 *
 * Those paths used `TokenPlan.getInstance()`, which throws when the store is
 * empty. The throw did not surface as "token plans are unavailable". It failed
 * the whole provider, so every model from it vanished from the picker behind a
 * single `Error getting model info from "<provider>"` log line. A store that
 * has not been initialised has a perfectly good answer for a read — no plans —
 * and these paths now ask for that instead of asserting.
 */

import * as assert from "assert";
import * as vscode from "vscode";
import { BaseChatProvider } from "../core/chat-provider";
import type { ModelPickerChatInformation } from "../core/chat-provider";
import { CONFIG_SECTION, type ModelDefinition } from "../core/models";
import type { IModelProvider } from "../core/model-provider";
import { TokenPlan } from "../core/token-plan";

const PROVIDER = "deepseek";

const MODEL: ModelDefinition = {
  id: "deepseek-flash",
  name: "DeepSeek V4.1 Flash",
  family: "deepseek",
  version: "v4.1",
  detail: "test model",
  maxInputTokens: 1_000_000,
  maxOutputTokens: 384_000,
  capabilities: { toolCalling: true, imageInput: true, thinking: true },
};

function createStubProvider(): IModelProvider {
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
    getModels: () => [MODEL],
    createClient: () => ({}) as never,
  };
}

function createStubContext(): vscode.ExtensionContext {
  return {
    extension: { id: "chihqiang.vscode-copilot-models" },
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

class TestableProvider extends BaseChatProvider {
  constructor() {
    super(createStubContext(), createStubProvider());
  }
}

const MODEL_INFO = {
  id: MODEL.id,
  name: MODEL.name,
  family: MODEL.family,
  version: "v4.1",
  maxInputTokens: MODEL.maxInputTokens,
  maxOutputTokens: MODEL.maxOutputTokens,
} as vscode.LanguageModelChatInformation;

function createToken(): vscode.CancellationToken {
  return new vscode.CancellationTokenSource().token;
}

suite("provider without an initialized plan store Test Suite", () => {
  let provider: TestableProvider;

  setup(() => {
    // Explicit, rather than relying on another suite having reset it: the
    // point is that this state is reachable at any time.
    TokenPlan.resetInstance();
    provider = new TestableProvider();
  });

  teardown(() => {
    provider.dispose();
  });

  test("the plan store really is uninitialized", () => {
    // Guards the premise: if this ever fails, the tests below prove nothing.
    assert.strictEqual(TokenPlan.isInitialized(), false);
    assert.strictEqual(TokenPlan.getOptional(), undefined);
  });

  test("model information is still produced", async () => {
    const models = await provider.provideLanguageModelChatInformation(
      { silent: true } as vscode.PrepareLanguageModelChatModelOptions,
      createToken(),
    );

    assert.strictEqual(models.length, 1);
    assert.strictEqual(models[0].id, MODEL.id);
  });

  test("models are reported as needing an API key, not as covered by a plan", async () => {
    const models = (await provider.provideLanguageModelChatInformation(
      { silent: true } as vscode.PrepareLanguageModelChatModelOptions,
      createToken(),
    )) as ModelPickerChatInformation[];

    // The stub has no key and there is no plan store to consult, so this is the
    // only answer that does not require a credential.
    assert.strictEqual(models[0].isUserSelectable, false);
    assert.strictEqual(models[0].detail, "API key required");
  });

  test("a chat request fails on the missing credential, not on the missing store", async () => {
    // The plan lookup comes before the credential check, so a throwing lookup
    // would report `Singleton not initialized` for what is really "configure an
    // API key" — sending the user to the logs for the wrong reason.
    await assert.rejects(
      () =>
        provider.provideLanguageModelChatResponse(
          MODEL_INFO,
          [
            vscode.LanguageModelChatMessage.User("hi"),
          ] as unknown as vscode.LanguageModelChatRequestMessage[],
          {
            toolMode: vscode.LanguageModelChatToolMode.Auto,
          } as vscode.ProvideLanguageModelChatResponseOptions,
          { report: () => {} },
          createToken(),
        ),
      (error: Error) => {
        assert.strictEqual(error.message, "API key not configured");
        return true;
      },
    );
  });

  test("the strict accessor still throws, so the distinction is deliberate", () => {
    // Callers that genuinely require a store — the wizards, the usage commands,
    // all of which run only after activation — keep the loud failure.
    assert.throws(() => TokenPlan.getInstance(), /Singleton not initialized/);
  });
});
