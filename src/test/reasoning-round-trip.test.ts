/**
 * Regression tests for the reasoning round-trip.
 *
 * DeepSeek's thinking mode requires the reasoning of previous turns to be sent
 * back whenever the request carries a `tools` parameter, and answers a missing
 * `reasoning_content` with a 400 — its own guide says so explicitly. The
 * converter used to drop any assistant message with no text and no tool calls,
 * which is exactly what a turn the user interrupted looks like, taking the
 * reasoning with it. Without tools the field is ignored by the provider, so an
 * empty assistant message is still dropped: some APIs reject one.
 */

import * as assert from "assert";
import * as vscode from "vscode";
import { BaseChatProvider } from "../core/chat-provider";
import { CONFIG_SECTION, type ModelDefinition } from "../core/models";
import type { IModelProvider } from "../core/model-provider";

const PROVIDER = "deepseek";
const REASONING = "The user wants the date, so I should call get_date first.";

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

  toApiMessages(
    messages: vscode.LanguageModelChatRequestMessage[],
    hasTools = false,
  ) {
    return this.convertMessages(messages, hasTools);
  }
}

/** An assistant message whose only content is reasoning. */
function reasoningOnlyMessage(): vscode.LanguageModelChatMessage {
  return vscode.LanguageModelChatMessage.Assistant([
    new vscode.LanguageModelThinkingPart(REASONING),
  ] as unknown as vscode.LanguageModelTextPart[]);
}

suite("reasoning round-trip Test Suite", () => {
  let provider: TestableProvider;

  setup(() => {
    provider = new TestableProvider();
  });

  teardown(() => {
    provider.dispose();
  });

  test("keeps reasoning-only output when the request carries tools", () => {
    // The documented requirement: with `tools` present, missing
    // `reasoning_content` is a 400.
    const messages = provider.toApiMessages([reasoningOnlyMessage()], true);

    assert.strictEqual(messages.length, 1);
    assert.strictEqual(messages[0].role, "assistant");
    assert.strictEqual(
      (messages[0] as { reasoning_content?: string }).reasoning_content,
      REASONING,
    );
  });

  test("still drops an empty assistant message without tools", () => {
    // Nothing is gained by sending it, and an assistant message with no
    // content is rejected by some providers.
    const messages = provider.toApiMessages([reasoningOnlyMessage()], false);

    assert.deepStrictEqual(messages, []);
  });

  test("still drops a genuinely empty assistant message with tools", () => {
    // The reason to keep the message is the reasoning it carries; with none
    // there is nothing to keep.
    const empty = vscode.LanguageModelChatMessage.Assistant([]);
    const messages = provider.toApiMessages([empty], true);

    assert.deepStrictEqual(messages, []);
  });

  test("sends reasoning alongside text and tool calls", () => {
    const message = vscode.LanguageModelChatMessage.Assistant([
      new vscode.LanguageModelThinkingPart(REASONING),
      new vscode.LanguageModelTextPart("Let me check."),
      new vscode.LanguageModelToolCallPart("call-1", "get_date", {}),
    ] as unknown as vscode.LanguageModelTextPart[]);

    const [apiMessage] = provider.toApiMessages([message], true);
    const asRecord = apiMessage as {
      content?: unknown;
      reasoning_content?: string;
      tool_calls?: unknown[];
    };

    assert.strictEqual(asRecord.content, "Let me check.");
    assert.strictEqual(asRecord.reasoning_content, REASONING);
    assert.strictEqual(asRecord.tool_calls?.length, 1);
  });

  test("counts assistant reasoning in the token estimate", () => {
    // The reasoning is sent, and the provider concatenates it into the
    // context, so leaving it out of the estimate under-reports how full the
    // context really is.
    const withReasoning = vscode.LanguageModelChatMessage.Assistant([
      new vscode.LanguageModelThinkingPart(REASONING.repeat(20)),
    ] as unknown as vscode.LanguageModelTextPart[]);
    const withoutReasoning = vscode.LanguageModelChatMessage.User([
      new vscode.LanguageModelThinkingPart(REASONING.repeat(20)),
    ] as unknown as vscode.LanguageModelTextPart[]);

    const counted = provider.provideTokenCount(
      {} as vscode.LanguageModelChatInformation,
      withReasoning,
      new vscode.CancellationTokenSource().token,
    );
    const notCounted = provider.provideTokenCount(
      {} as vscode.LanguageModelChatInformation,
      withoutReasoning,
      new vscode.CancellationTokenSource().token,
    );

    return Promise.all([counted, notCounted]).then(([a, b]) => {
      assert.ok(a > 0, "assistant reasoning is sent, so it must be counted");
      assert.strictEqual(
        b,
        0,
        "only the assistant branch sends reasoning back",
      );
    });
  });
});
