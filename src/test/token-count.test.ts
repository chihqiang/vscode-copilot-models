/**
 * Regression tests for token estimation.
 *
 * `provideTokenCount` feeds VS Code the context size it uses to decide whether
 * a request still fits, so it must account for the same content the request
 * carries. It previously counted only text parts while `convertMessages` also
 * sends tool results, tool-call arguments and prompt-TSX parts, so a
 * tool-heavy conversation reported a fraction of its real size.
 */

import * as assert from "assert";
import * as vscode from "vscode";
import { BaseChatProvider } from "../core/chat-provider";
import { CONFIG_SECTION, type ModelDefinition } from "../core/models";
import type { IModelProvider } from "../core/model-provider";

const PROVIDER = "deepseek";

/** Big enough that any counting difference dwarfs the tokenizer's own noise. */
const BULK = "the quick brown fox jumps over the lazy dog ".repeat(200);

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

class TestableProvider extends BaseChatProvider {
  constructor() {
    super(createStubContext(), createStubProvider());
  }
}

const MODEL_INFO = {
  id: "test-model",
  name: "Test Model",
  family: "test",
  version: "1",
  maxInputTokens: 1000,
  maxOutputTokens: 100,
} as vscode.LanguageModelChatInformation;

function createToken(): vscode.CancellationToken {
  return new vscode.CancellationTokenSource().token;
}

suite("provideTokenCount coverage Test Suite", () => {
  let provider: TestableProvider;

  setup(() => {
    provider = new TestableProvider();
  });

  teardown(() => {
    provider.dispose();
  });

  async function count(
    message: vscode.LanguageModelChatRequestMessage,
  ): Promise<number> {
    return provider.provideTokenCount(MODEL_INFO, message, createToken());
  }

  test("counts text from a tool result", async () => {
    const withResult = vscode.LanguageModelChatMessage.User([
      new vscode.LanguageModelToolResultPart("call-1", [
        new vscode.LanguageModelTextPart(BULK),
      ]),
    ]);
    const plain = vscode.LanguageModelChatMessage.User("hi");
    // The message itself holds no text part, so counting only text parts would
    // score it the same as a two-character prompt.
    assert.notStrictEqual(await count(plain), 0);
    const bulkCount = await count(withResult);
    assert.ok(
      bulkCount > (await count(plain)) * 10,
      `expected the tool result to dominate the count, got ${bulkCount}`,
    );
  });

  test("counts tool-call arguments", async () => {
    const withCall = vscode.LanguageModelChatMessage.Assistant([
      new vscode.LanguageModelToolCallPart("call-1", "search", {
        query: BULK,
      }),
    ]);
    const emptyCall = vscode.LanguageModelChatMessage.Assistant([
      new vscode.LanguageModelToolCallPart("call-1", "search", {}),
    ]);

    assert.ok(
      (await count(withCall)) > (await count(emptyCall)) * 10,
      "tool-call arguments are sent, so they must be counted",
    );
  });

  test("counts a prompt-TSX part", async () => {
    // The declared constructor union for a user message excludes prompt-TSX
    // parts, but a request message's content is `LanguageModelInputPart |
    // unknown` — which is exactly why convertMessages checks for the type. The
    // cast reproduces what this code can actually receive.
    const withTsx = vscode.LanguageModelChatMessage.User([
      new vscode.LanguageModelPromptTsxPart(BULK),
    ] as unknown as vscode.LanguageModelTextPart[]);
    const plain = vscode.LanguageModelChatMessage.User("hi");

    assert.ok(
      (await count(withTsx)) > (await count(plain)) * 10,
      "prompt-TSX content is sent, so it must be counted",
    );
  });

  test("counts the placeholder sent in place of binary tool output", async () => {
    // convertMessages refuses to serialize binary parts and sends a short
    // placeholder instead. The estimate must match what is sent — not the
    // blob's byte length.
    const withBinary = vscode.LanguageModelChatMessage.User([
      new vscode.LanguageModelToolResultPart("call-1", [
        new vscode.LanguageModelDataPart(new Uint8Array(50_000), "image/png"),
      ]),
    ]);

    const binaryCount = await count(withBinary);
    assert.ok(
      binaryCount > 0 && binaryCount < 100,
      `expected the placeholder's size, not the blob's, got ${binaryCount}`,
    );
  });

  test("counts a plain string argument", async () => {
    const count1 = await provider.provideTokenCount(
      MODEL_INFO,
      BULK,
      createToken(),
    );
    assert.ok(count1 > 100, `expected a large count, got ${count1}`);
  });
});
