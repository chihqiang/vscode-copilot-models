/**
 * Regression tests for vision proxy image resolution.
 *
 * Models that accept image input natively must receive the real images. The
 * proxy previously ran unconditionally, so picking a vision-capable model and
 * attaching an image silently replaced it with a lossy text description.
 */

import * as assert from "assert";
import * as vscode from "vscode";
import {
  VISION_PROXY_API_KEY_SECRET,
  clearVisionProxyApiKey,
  hasVisionProxyApiKey,
  resolveImageMessages,
  resolveVisionCompletionUrl,
  storeVisionProxyApiKey,
  type VisionDescriber,
  type VisionService,
} from "../core/vision";

interface Stub {
  service: VisionService;
  describeCalls: () => number;
}

/** Build a VisionService stub whose describer counts invocations. */
function createVisionServiceStub(description = "a red square"): Stub {
  let calls = 0;

  const describer: VisionDescriber = {
    id: "stub-describer",
    source: "vscode-lm",
    describe: async () => {
      calls++;
      return description;
    },
  };

  return {
    service: {
      get: async () => describer,
    } as unknown as VisionService,
    describeCalls: () => calls,
  };
}

function createImageMessage(): vscode.LanguageModelChatMessage {
  const imageData = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
  return vscode.LanguageModelChatMessage.User([
    new vscode.LanguageModelTextPart("what is in this image?"),
    new vscode.LanguageModelDataPart(imageData, "image/png"),
  ]);
}

function containsImagePart(
  message: vscode.LanguageModelChatRequestMessage,
): boolean {
  return message.content.some(
    (part) => part instanceof vscode.LanguageModelDataPart,
  );
}

function createToken(): vscode.CancellationToken {
  return new vscode.CancellationTokenSource().token;
}

suite("resolveImageMessages Test Suite", () => {
  test("bypasses the proxy when the model supports image input", async () => {
    const stub = createVisionServiceStub();
    const message = createImageMessage();

    const result = await resolveImageMessages(
      [message],
      createToken(),
      stub.service,
      {
        skipVisionProxy: true,
      },
    );

    assert.strictEqual(
      stub.describeCalls(),
      0,
      "a vision-capable model must not trigger a proxy description",
    );
    assert.strictEqual(
      result.messages[0],
      message,
      "messages must be returned untouched",
    );
    assert.strictEqual(
      containsImagePart(result.messages[0]),
      true,
      "the original image part must survive",
    );
  });

  test("replaces images with a description when the proxy runs", async () => {
    const stub = createVisionServiceStub("a red square");
    const message = createImageMessage();

    const result = await resolveImageMessages(
      [message],
      createToken(),
      stub.service,
    );

    assert.strictEqual(stub.describeCalls(), 1);
    assert.strictEqual(
      containsImagePart(result.messages[0]),
      false,
      "the image should be replaced by its description",
    );

    const text = result.messages[0].content
      .map((part) =>
        part instanceof vscode.LanguageModelTextPart ? part.value : "",
      )
      .join("");
    assert.ok(
      text.includes("a red square"),
      `expected the description in "${text}"`,
    );
  });

  test("does nothing when the conversation has no images", async () => {
    const stub = createVisionServiceStub();
    const messages = [vscode.LanguageModelChatMessage.User("just text")];

    const result = await resolveImageMessages(
      messages,
      createToken(),
      stub.service,
    );

    assert.strictEqual(stub.describeCalls(), 0);
    assert.strictEqual(
      result.messages,
      messages,
      "messages must be passed through by reference",
    );
    assert.strictEqual(result.stats.inputImageParts, 0);
  });
});

suite("resolveVisionCompletionUrl Test Suite", () => {
  test("appends the chat completions path to a base URL", () => {
    assert.strictEqual(
      resolveVisionCompletionUrl("https://api.example.com/v1"),
      "https://api.example.com/v1/chat/completions",
    );
  });

  test("does not duplicate the path when it is already present", () => {
    assert.strictEqual(
      resolveVisionCompletionUrl("https://api.example.com/v1/chat/completions"),
      "https://api.example.com/v1/chat/completions",
    );
  });

  test("normalizes trailing slashes and surrounding whitespace", () => {
    assert.strictEqual(
      resolveVisionCompletionUrl("  https://api.example.com/v1//  "),
      "https://api.example.com/v1/chat/completions",
    );
    assert.strictEqual(
      resolveVisionCompletionUrl(
        "https://api.example.com/v1/chat/completions/",
      ),
      "https://api.example.com/v1/chat/completions",
    );
  });
});

suite("vision proxy API key storage Test Suite", () => {
  /** Minimal in-memory SecretStorage stand-in. */
  function createSecretStorage(): {
    secrets: vscode.SecretStorage;
    store: Map<string, string>;
  } {
    const store = new Map<string, string>();
    const secrets = {
      get: async (key: string) => store.get(key),
      store: async (key: string, value: string) => {
        store.set(key, value);
      },
      delete: async (key: string) => {
        store.delete(key);
      },
      onDidChange: () => ({ dispose: () => {} }),
    } as unknown as vscode.SecretStorage;
    return { secrets, store };
  }

  test("round-trips a key through SecretStorage", async () => {
    const { secrets, store } = createSecretStorage();

    assert.strictEqual(await hasVisionProxyApiKey(secrets), false);

    await storeVisionProxyApiKey(secrets, "  sk-test-key  ");

    assert.strictEqual(
      store.get(VISION_PROXY_API_KEY_SECRET),
      "sk-test-key",
      "the key must be trimmed before storing",
    );
    assert.strictEqual(await hasVisionProxyApiKey(secrets), true);
  });

  test("clears a stored key and tolerates a missing one", async () => {
    const { secrets } = createSecretStorage();
    await storeVisionProxyApiKey(secrets, "sk-test-key");

    await clearVisionProxyApiKey(secrets);
    assert.strictEqual(await hasVisionProxyApiKey(secrets), false);

    // Clearing again must not throw.
    await clearVisionProxyApiKey(secrets);
    assert.strictEqual(await hasVisionProxyApiKey(secrets), false);
  });
});
