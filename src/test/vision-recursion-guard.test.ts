/**
 * Regression tests for the vision proxy's recursion guard.
 *
 * The describer reaches this extension's own provider when the model it picked
 * is one of ours, and its request carries the image. Proxying that nested
 * request would start the description again — an unbounded loop, each round a
 * real, billable API call.
 *
 * The guard has to be narrow, though. It keys on the model being described
 * with and on the request actually carrying an image, because a self-initiated
 * request without one is legitimate: an AI-generated commit message runs on a
 * text-only model of ours and must not be mistaken for a nested description.
 */

import * as assert from "assert";
import * as vscode from "vscode";
import { BaseChatProvider } from "../core/chat-provider";
import { CONFIG_SECTION, type ModelDefinition } from "../core/models";
import type { IModelProvider } from "../core/model-provider";
import { visionModelNeedsImageInputMessage } from "../core/vision";

const PROVIDER = "deepseek";
const EXTENSION_ID = "chihqiang.vscode-copilot-models";

/** A model this extension serves that cannot accept images. */
const BLIND_MODEL: ModelDefinition = {
  id: "glm-5.3",
  name: "GLM-5.3",
  family: "glm",
  version: "5.3",
  detail: "test model",
  maxInputTokens: 1_000_000,
  maxOutputTokens: 128_000,
  capabilities: { toolCalling: true, imageInput: false, thinking: true },
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
    getModels: () => [BLIND_MODEL],
    createClient: () => ({}) as never,
  };
}

function createStubContext(): vscode.ExtensionContext {
  return {
    extension: { id: EXTENSION_ID },
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
  id: BLIND_MODEL.id,
  name: BLIND_MODEL.name,
  family: BLIND_MODEL.family,
  version: "5.3",
  maxInputTokens: BLIND_MODEL.maxInputTokens,
  maxOutputTokens: BLIND_MODEL.maxOutputTokens,
} as vscode.LanguageModelChatInformation;

function imageMessage(): vscode.LanguageModelChatRequestMessage {
  return vscode.LanguageModelChatMessage.User([
    new vscode.LanguageModelTextPart("what is this?"),
    new vscode.LanguageModelDataPart(new Uint8Array([1, 2, 3]), "image/png"),
  ]) as unknown as vscode.LanguageModelChatRequestMessage;
}

function textMessage(): vscode.LanguageModelChatRequestMessage {
  return vscode.LanguageModelChatMessage.User(
    "write a commit message",
  ) as unknown as vscode.LanguageModelChatRequestMessage;
}

/** Run a request and return the error it failed with, or undefined. */
async function send(
  provider: TestableProvider,
  messages: vscode.LanguageModelChatRequestMessage[],
  requestInitiator?: string,
): Promise<Error | undefined> {
  const options = {
    toolMode: vscode.LanguageModelChatToolMode.Auto,
    ...(requestInitiator ? { requestInitiator } : {}),
  } as vscode.ProvideLanguageModelChatResponseOptions;

  try {
    await provider.provideLanguageModelChatResponse(
      MODEL_INFO,
      messages,
      options,
      { report: () => {} },
      new vscode.CancellationTokenSource().token,
    );
    return undefined;
  } catch (error) {
    return error as Error;
  }
}

suite("vision proxy recursion guard Test Suite", () => {
  let provider: TestableProvider;

  setup(() => {
    provider = new TestableProvider();
  });

  teardown(() => {
    provider.dispose();
  });

  test("refuses to describe an image with a model that cannot see it", async () => {
    // This is the loop: the describer picked one of our own models, so its
    // request arrives right here, carrying the image. Refusing it ends the
    // recursion where the old code restarted it; the caller turns this into
    // the "Vision proxy failed" notice.
    const error = await send(provider, [imageMessage()], EXTENSION_ID);

    assert.ok(error, "a nested description must not be proxied again");
    assert.strictEqual(
      error.message,
      visionModelNeedsImageInputMessage("glm-5.3"),
    );
  });

  test("the refusal is not a generic provider error", async () => {
    const error = await send(provider, [imageMessage()], EXTENSION_ID);

    assert.ok(error);
    assert.ok(
      error.message.includes("glm-5.3"),
      "it has to name the model that was misconfigured",
    );
    assert.ok(
      error.message.includes("Copilot Models: Set Vision Model"),
      "and say how to fix it",
    );
  });

  test("a self-initiated request without an image is left alone", async () => {
    // An AI-generated commit message runs on a text-only model of ours with
    // this extension as the initiator. Refusing it would break the feature
    // the guard exists to protect.
    const error = await send(provider, [textMessage()], EXTENSION_ID);

    assert.notStrictEqual(
      error?.message,
      visionModelNeedsImageInputMessage("glm-5.3"),
      "a request with no image cannot be a nested description",
    );
  });

  test("a request from the editor is left alone", async () => {
    // `core` is what VS Code reports for its own chat. The model still cannot
    // see the image, so the normal proxy path runs — and this stub has no API
    // key, so it fails there rather than in the guard.
    const error = await send(provider, [imageMessage()], "core");

    assert.notStrictEqual(
      error?.message,
      visionModelNeedsImageInputMessage("glm-5.3"),
    );
  });

  test("a request with no initiator at all is left alone", async () => {
    // Nothing reported means "unknown", which must not be read as "ours".
    const error = await send(provider, [imageMessage()]);

    assert.notStrictEqual(
      error?.message,
      visionModelNeedsImageInputMessage("glm-5.3"),
    );
  });

  test("the initiator comparison ignores case", async () => {
    // VS Code lowercases the extension id it reports; the manifest keeps its
    // own casing, so comparing raw strings would never match.
    const error = await send(
      provider,
      [imageMessage()],
      EXTENSION_ID.toUpperCase(),
    );

    assert.strictEqual(
      error?.message,
      visionModelNeedsImageInputMessage("glm-5.3"),
    );
  });
});
