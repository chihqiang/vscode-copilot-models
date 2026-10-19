/**
 * Regression tests for the reasoning round-trip.
 *
 * DeepSeek's thinking mode requires the reasoning of previous turns to be sent
 * back on every request, and answers a missing `reasoning_content` with a 400 —
 * its own guide says so explicitly. The converter used to drop any assistant
 * message with no text and no tool calls, which is exactly what a turn the user
 * interrupted looks like, taking the reasoning with it. A genuinely empty
 * assistant message (no reasoning, no text, no tool calls) is still dropped:
 * some APIs reject one.
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

  protected override get requiresReasoningContent(): boolean {
    return true;
  }

  toApiMessages(
    messages: vscode.LanguageModelChatRequestMessage[],
    hasTools = false,
    requiresReasoningContent = false,
  ) {
    return this.convertMessages(messages, hasTools, requiresReasoningContent);
  }

  /** Drive the stream callbacks without a network request. */
  captureStream(
    thinking: string,
    content: string,
    toolCallIds: readonly string[] = [],
  ): void {
    const callbacks = this.createStreamCallbacks({
      report: () => {},
    } as unknown as vscode.Progress<vscode.LanguageModelResponsePart>);

    if (thinking) {
      callbacks.onThinking(thinking);
    }
    if (content) {
      callbacks.onContent(content);
    }
    for (const id of toolCallIds) {
      callbacks.onToolCall({
        id,
        type: "function",
        function: { name: "tool", arguments: "{}" },
      });
    }
    callbacks.onDone();
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

  test("keeps reasoning-only output even without tools", () => {
    // DeepSeek's thinking mode requires reasoning_content to be passed back
    // on every request, not only when tools are present — otherwise it
    // returns a 400. A reasoning-only assistant message is what a turn the
    // user interrupted looks like, so dropping it loses the reasoning and
    // the next request fails.
    const messages = provider.toApiMessages([reasoningOnlyMessage()], false);

    assert.strictEqual(messages.length, 1);
    assert.strictEqual(messages[0].role, "assistant");
    assert.strictEqual(
      (messages[0] as { reasoning_content?: string }).reasoning_content,
      REASONING,
    );
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

  test("replays reasoning by tool call ID when history has no thinking part", () => {
    // VS Code does not always include thinking parts when it re-sends the
    // conversation, but the tool call ID is stable. Without this cache the
    // next DeepSeek request is a 400.
    provider.captureStream(REASONING, "", ["call-1"]);

    const message = vscode.LanguageModelChatMessage.Assistant([
      new vscode.LanguageModelToolCallPart("call-1", "get_date", {}),
    ] as unknown as vscode.LanguageModelTextPart[]);
    const [apiMessage] = provider.toApiMessages([message], true, true);

    assert.strictEqual(
      (apiMessage as { reasoning_content?: string }).reasoning_content,
      REASONING,
    );
  });

  test("replays reasoning by assistant text when there is no tool call", () => {
    const content = "The date is Tuesday.";
    provider.captureStream(REASONING, content);

    const message = vscode.LanguageModelChatMessage.Assistant([
      new vscode.LanguageModelTextPart(content),
    ]);
    const [apiMessage] = provider.toApiMessages([message], false, true);

    assert.strictEqual(
      (apiMessage as { reasoning_content?: string }).reasoning_content,
      REASONING,
    );
  });

  test("sends an empty reasoning_content when a required turn has none", () => {
    // A turn that produced no reasoning (for example after switching models)
    // still has to carry the field; DeepSeek checks for its presence.
    const message = vscode.LanguageModelChatMessage.Assistant([
      new vscode.LanguageModelTextPart("No reasoning."),
    ]);
    const [apiMessage] = provider.toApiMessages([message], true, true);

    assert.strictEqual(
      (apiMessage as { reasoning_content?: string }).reasoning_content,
      "",
    );
  });

  test("does not invent reasoning_content when the provider allows it", () => {
    const message = vscode.LanguageModelChatMessage.Assistant([
      new vscode.LanguageModelTextPart("No reasoning."),
    ]);
    const [apiMessage] = provider.toApiMessages([message], true, false);

    assert.strictEqual(
      (apiMessage as { reasoning_content?: string }).reasoning_content,
      undefined,
    );
  });
});
