/**
 * Regression tests for non-image `LanguageModelDataPart` content.
 *
 * A data part is not only an image: `DataPart.json()` and `DataPart.text()`
 * carry structured tool output. `convertMessages` skipped every part whose
 * MIME type was not `image/*`, so those payloads were dropped without a log
 * line — the model saw an empty message where a tool had returned data. The
 * vision proxy dropped them a second time, because rebuilding a message around
 * an image description carried over text parts only.
 */

import * as assert from "assert";
import * as vscode from "vscode";
import {
  BaseChatProvider,
  dataPartText,
  messageTextForTokenCount,
} from "../core/chat-provider";
import { CONFIG_SECTION, type ModelDefinition } from "../core/models";
import type { IModelProvider } from "../core/model-provider";

const PROVIDER = "deepseek";

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

  /** `convertMessages` is protected; the request payload is under test. */
  toApiMessages(messages: vscode.LanguageModelChatRequestMessage[]) {
    return this.convertMessages(messages);
  }
}

/** The `content` of the only message, which is a plain string for text-only. */
function onlyContent(messages: ReturnType<TestableProvider["toApiMessages"]>) {
  assert.strictEqual(messages.length, 1);
  return messages[0].content;
}

suite("non-image data part Test Suite", () => {
  let provider: TestableProvider;

  setup(() => {
    provider = new TestableProvider();
  });

  teardown(() => {
    provider.dispose();
  });

  test("decodes JSON data", () => {
    const part = vscode.LanguageModelDataPart.json({ answer: 42 });

    // The ext host pretty-prints JSON, so compare the decoded value rather
    // than the exact string.
    assert.deepStrictEqual(JSON.parse(dataPartText(part)), { answer: 42 });
  });

  test("decodes generic textual data", () => {
    assert.strictEqual(
      dataPartText(vscode.LanguageModelDataPart.text("<b>hi</b>", "text/html")),
      "<b>hi</b>",
    );
  });

  test("omits binary data that is not an image, naming its type", () => {
    // Audio and video cannot be inlined into a JSON request body. The point is
    // that the model can tell "a file came back" from "the tool returned
    // nothing".
    const text = dataPartText(
      new vscode.LanguageModelDataPart(new Uint8Array(2048), "audio/wav"),
    );

    assert.ok(text.includes("audio/wav"), `expected the type, got "${text}"`);
    assert.ok(text.includes("2048"), `expected the size, got "${text}"`);
  });

  test("sends JSON from a user message to the provider", () => {
    const messages = provider.toApiMessages([
      vscode.LanguageModelChatMessage.User([
        new vscode.LanguageModelTextPart("here is the data: "),
        vscode.LanguageModelDataPart.json({ answer: 42 }),
      ]),
    ]);

    const content = onlyContent(messages);
    assert.strictEqual(typeof content, "string");
    const prefix = "here is the data: ";
    assert.ok(
      (content as string).startsWith(prefix),
      `the surrounding text must be kept, got "${content}"`,
    );
    assert.deepStrictEqual(
      JSON.parse((content as string).slice(prefix.length)),
      { answer: 42 },
      "the JSON payload must reach the provider",
    );
  });

  test("keeps a data part as a content part once the message has an image", () => {
    // After an image the message is sent as an array of content parts, so a
    // later text or data part has to be pushed as a part rather than buffered.
    const messages = provider.toApiMessages([
      vscode.LanguageModelChatMessage.User([
        new vscode.LanguageModelTextPart("before"),
        new vscode.LanguageModelDataPart(
          new Uint8Array([1, 2, 3]),
          "image/png",
        ),
        vscode.LanguageModelDataPart.json({ after: true }),
      ]),
    ]);

    const content = onlyContent(messages);
    assert.ok(Array.isArray(content), "an image message becomes a part array");
    const parts = content as Array<{ type: string; text?: string }>;
    assert.deepStrictEqual(
      parts.map((p) => p.type),
      ["text", "image_url", "text"],
    );
    assert.deepStrictEqual(JSON.parse(parts[2].text ?? ""), { after: true });
  });

  test("sends JSON returned by a tool", () => {
    const messages = provider.toApiMessages([
      vscode.LanguageModelChatMessage.User([
        new vscode.LanguageModelToolResultPart("call-1", [
          vscode.LanguageModelDataPart.json({ rows: [1, 2, 3] }),
        ]),
      ]),
    ]);

    const toolMessage = messages.find((m) => m.role === "tool");
    assert.ok(toolMessage, "the tool result must be sent");
    assert.deepStrictEqual(JSON.parse(toolMessage.content), {
      rows: [1, 2, 3],
    });
  });

  test("counts JSON content, so the estimate matches the request", () => {
    // `provideTokenCount` feeds the context-size decision. Content that is
    // sent but not counted makes a conversation look smaller than it is.
    const withData = vscode.LanguageModelChatMessage.User([
      vscode.LanguageModelDataPart.json({ payload: "x".repeat(4000) }),
    ]);
    const empty = vscode.LanguageModelChatMessage.User([
      vscode.LanguageModelDataPart.json({}),
    ]);

    assert.ok(
      messageTextForTokenCount(withData).length >
        messageTextForTokenCount(empty).length * 100,
      "a large JSON payload must dominate the count",
    );
  });

  test("still excludes image bytes from the count", () => {
    // Images travel as base64 data URLs, whose size no token estimate models;
    // counting them would overstate the context and truncate early.
    const withImage = vscode.LanguageModelChatMessage.User([
      new vscode.LanguageModelDataPart(new Uint8Array(100_000), "image/png"),
    ]);

    assert.strictEqual(messageTextForTokenCount(withImage), "");
  });
});
