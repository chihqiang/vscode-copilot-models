/**
 * Regression tests for what the model picker is told about a model.
 *
 * Two fields on `LanguageModelChatInformation` were not reported:
 *
 * - `isBYOK`, the statement that these models are served with the user's own
 *   credentials. VS Code infers the same for any provider that is not the
 *   Copilot Chat extension, so this one is about saying it rather than having
 *   it derived from the extension identity.
 * - `capabilities.editTools`, which replaces the editor's "try several edit
 *   tools and pick one" default with a claim about the model. It is reported
 *   from the `copilot-models.editTools` setting only, so an unconfigured
 *   install keeps the editor's own behaviour. (Setting it also requires the
 *   `chatProvider` proposal to be declared — see identifiers.test.ts.)
 */

import * as assert from "assert";
import * as vscode from "vscode";
import { BaseChatProvider } from "../core/chat-provider";
import { CONFIG_SECTION, type ModelDefinition } from "../core/models";
import type { IModelProvider } from "../core/model-provider";
import { SETTING_EDIT_TOOLS } from "../core/settings";

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
    getApiKey: async () => "sk-test",
    hasApiKey: async () => true,
    promptForApiKey: async () => true,
    deleteApiKey: async () => {},
    getModels: () => [MODEL],
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

class TestableProvider extends BaseChatProvider {
  constructor() {
    super(createStubContext(), createStubProvider());
  }

  /** `toChatInfo` is protected; the picker payload is what is under test. */
  describeModel(hasApiKey = true, hasPlan = false) {
    return this.toChatInfo(MODEL, hasApiKey, hasPlan);
  }
}

/** Write the edit-tools setting, restoring the default afterwards. */
async function setEditTools(tools: string[]): Promise<void> {
  await vscode.workspace
    .getConfiguration(CONFIG_SECTION)
    .update(SETTING_EDIT_TOOLS, tools, vscode.ConfigurationTarget.Global);
}

suite("model picker information Test Suite", () => {
  let provider: TestableProvider;

  setup(async () => {
    await setEditTools([]);
    provider = new TestableProvider();
  });

  teardown(async () => {
    provider.dispose();
    await setEditTools([]);
  });

  test("models are reported as BYOK", () => {
    // Every model here is paid for by the user's own key or token plan. The
    // editor reaches the same conclusion by inference; the assertion is here
    // so the declaration cannot be dropped silently.
    assert.strictEqual(provider.describeModel().isBYOK, true);
  });

  test("no edit tools are advertised by default", () => {
    // The field overrides the editor's own edit-tool selection, so an
    // unconfigured install must not carry it at all.
    assert.strictEqual(
      provider.describeModel().capabilities.editTools,
      undefined,
      "an empty setting must leave the capability unset, not []",
    );
  });

  test("configured edit tools are advertised", async () => {
    await setEditTools(["multi-find-replace", "find-replace"]);

    assert.deepStrictEqual(provider.describeModel().capabilities.editTools, [
      "multi-find-replace",
      "find-replace",
    ]);
  });

  test("the reading is live, not captured at construction", async () => {
    // Covers `toChatInfo` only. The setting also has to trigger a model-list
    // refresh, or VS Code keeps serving the capabilities it cached — that half
    // is asserted in chat-provider-config.test.ts.
    assert.strictEqual(
      provider.describeModel().capabilities.editTools,
      undefined,
    );
    await setEditTools(["apply-patch"]);
    assert.deepStrictEqual(provider.describeModel().capabilities.editTools, [
      "apply-patch",
    ]);
  });

  test("a model without a key stays unselectable", () => {
    const info = provider.describeModel(false, false);

    assert.strictEqual(info.isUserSelectable, false);
    assert.strictEqual(info.detail, "API key required");
    // BYOK says who pays, not whether the model is usable — it stays true.
    assert.strictEqual(info.isBYOK, true);
  });
});
