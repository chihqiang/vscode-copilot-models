/**
 * Regression tests for vision proxy image resolution.
 *
 * Models that accept image input natively must receive the real images. The
 * proxy previously ran unconditionally, so picking a vision-capable model and
 * attaching an image silently replaced it with a lossy text description.
 */

import * as assert from "assert";
import * as vscode from "vscode";
import { CONFIG_SECTION } from "../core/models";
import {
  IMAGE_DESCRIPTION_UNAVAILABLE,
  VISION_API_ENDPOINT_ID,
  VISION_PROXY_API_KEY_SECRET,
  VisionService,
  clearVisionProxyApiKey,
  hasVisionProxyApiKey,
  resolveImageMessages,
  resolveVisionCompletionUrl,
  storeVisionProxyApiKey,
  visionAffectingConfigKeys,
  type VisionDescriber,
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

suite("resolveImageMessages without a describer Test Suite", () => {
  test("replaces the image with a placeholder and reports a notice", async () => {
    // VisionService.get() returns undefined for an incomplete custom endpoint.
    const service = {
      get: async () => undefined,
    } as unknown as VisionService;
    const message = createImageMessage();

    const result = await resolveImageMessages(
      [message],
      createToken(),
      service,
    );

    assert.strictEqual(
      containsImagePart(result.messages[0]),
      false,
      "an undescribable image must not be forwarded to a model without image input",
    );
    assert.strictEqual(containsPlaceholder(result.messages[0]), true);
    assert.ok(
      result.initialResponseNotice?.includes("not configured"),
      `expected a configuration notice, got "${result.initialResponseNotice}"`,
    );
  });
});

/** Whether any text part of the message carries the placeholder. */
function containsPlaceholder(
  message: vscode.LanguageModelChatRequestMessage | undefined,
): boolean {
  return (
    message?.content.some(
      (part) =>
        part instanceof vscode.LanguageModelTextPart &&
        part.value.includes(IMAGE_DESCRIPTION_UNAVAILABLE),
    ) ?? false
  );
}

suite("resolveImageMessages placeholder Test Suite", () => {
  /** The message text joined back together, for assertions. */
  function textOf(
    message: vscode.LanguageModelChatRequestMessage | undefined,
  ): string {
    return (message?.content ?? [])
      .map((part) =>
        part instanceof vscode.LanguageModelTextPart ? part.value : "",
      )
      .join("");
  }

  test("replaces an older, un-described image with a placeholder", async () => {
    // Image in an earlier turn, then an assistant reply and a follow-up. The
    // proxy only describes the current turn, and this used to return early
    // with every message intact — forwarding the old image to a model that
    // cannot accept one.
    const messages = [
      createImageMessage(),
      vscode.LanguageModelChatMessage.Assistant("it is a red square"),
      vscode.LanguageModelChatMessage.User("and now?"),
    ];
    const stub = createVisionServiceStub();

    const result = await resolveImageMessages(
      messages,
      createToken(),
      stub.service,
    );

    assert.strictEqual(
      stub.describeCalls(),
      0,
      "an older image is not described again",
    );
    assert.strictEqual(
      containsImagePart(result.messages[0]),
      false,
      "the old image must not reach the model",
    );
    assert.strictEqual(containsPlaceholder(result.messages[0]), true);
  });

  test("replaces the image with a placeholder when the describer throws", async () => {
    const failing = {
      get: async () => ({
        id: "failing",
        source: "vscode-lm",
        describe: async () => {
          throw new Error("vision endpoint down");
        },
      }),
    } as unknown as VisionService;

    const result = await resolveImageMessages(
      [createImageMessage()],
      createToken(),
      failing,
    );

    assert.strictEqual(
      containsImagePart(result.messages[0]),
      false,
      "a failed description must not leave the image in the request",
    );
    assert.strictEqual(containsPlaceholder(result.messages[0]), true);
    assert.ok(
      result.initialResponseNotice?.includes("vision endpoint down"),
      `expected the failure to be reported, got "${result.initialResponseNotice}"`,
    );
  });

  test("replaces the image with a placeholder when the description is empty", async () => {
    const stub = createVisionServiceStub("");

    const result = await resolveImageMessages(
      [createImageMessage()],
      createToken(),
      stub.service,
    );

    assert.strictEqual(containsImagePart(result.messages[0]), false);
    assert.strictEqual(containsPlaceholder(result.messages[0]), true);
    assert.ok(result.initialResponseNotice?.includes("empty"));
  });

  test("keeps the role and the surrounding text", async () => {
    const messages = [
      createImageMessage(),
      vscode.LanguageModelChatMessage.Assistant("it is a red square"),
      vscode.LanguageModelChatMessage.User("and now?"),
    ];
    const stub = createVisionServiceStub();

    const result = await resolveImageMessages(
      messages,
      createToken(),
      stub.service,
    );

    assert.strictEqual(
      result.messages[0].role,
      vscode.LanguageModelChatMessageRole.User,
    );
    assert.ok(
      textOf(result.messages[0]).includes("what is in this image?"),
      `the text around the image must survive, got "${textOf(result.messages[0])}"`,
    );
  });

  test("leaves messages without images untouched", async () => {
    const plain = vscode.LanguageModelChatMessage.User("and now?");
    const messages = [
      createImageMessage(),
      vscode.LanguageModelChatMessage.Assistant("it is a red square"),
      plain,
    ];
    const stub = createVisionServiceStub();

    const result = await resolveImageMessages(
      messages,
      createToken(),
      stub.service,
    );

    assert.strictEqual(
      result.messages[2],
      plain,
      "a message without images needs no rebuild",
    );
  });
});

suite("visionAffectingConfigKeys Test Suite", () => {
  test("covers every setting captured when a describer is built", () => {
    const keys = visionAffectingConfigKeys();
    for (const name of [
      "visionModel",
      "visionPrompt",
      "visionProxy.apiUrl",
      "visionProxy.apiModelId",
      "visionProxy.timeoutMs",
      "visionProxy.maxTokens",
    ]) {
      assert.ok(
        keys.includes(`${CONFIG_SECTION}.${name}`),
        `${name} must reset the cached describer`,
      );
    }
  });
});

suite("VisionService describer resolution Test Suite", () => {
  const config = () => vscode.workspace.getConfiguration(CONFIG_SECTION);

  async function applySettings(values: Record<string, unknown>): Promise<void> {
    for (const [key, value] of Object.entries(values)) {
      await config().update(key, value, vscode.ConfigurationTarget.Global);
    }
  }

  function createService(): VisionService {
    return new VisionService({
      secrets: { onDidChange: () => ({ dispose: () => {} }) },
    } as unknown as vscode.ExtensionContext);
  }

  function resetSettings(): Promise<void> {
    return applySettings({
      visionModel: undefined,
      "visionProxy.apiUrl": undefined,
      "visionProxy.apiModelId": undefined,
      "visionProxy.timeoutMs": undefined,
      "visionProxy.maxTokens": undefined,
    });
  }

  teardown(resetSettings);

  test("returns undefined when the custom endpoint is incomplete", async () => {
    await applySettings({
      visionModel: VISION_API_ENDPOINT_ID,
      "visionProxy.apiUrl": "",
      "visionProxy.apiModelId": "",
    });

    const service = createService();
    try {
      assert.strictEqual(
        await service.get(),
        undefined,
        "an incomplete endpoint must not silently fall back to VS Code LM auto-detect",
      );
    } finally {
      service.dispose();
    }
  });

  test("builds and caches an API endpoint describer when complete", async () => {
    await applySettings({
      visionModel: VISION_API_ENDPOINT_ID,
      "visionProxy.apiUrl": "https://api.example.com/v1",
      "visionProxy.apiModelId": "gpt-4o",
    });

    const service = createService();
    try {
      const first = await service.get();
      assert.strictEqual(first?.source, "api-endpoint");
      assert.strictEqual(await service.get(), first, "the describer is cached");
    } finally {
      service.dispose();
    }
  });

  test("rebuilds the describer when the endpoint timeout changes", async () => {
    await applySettings({
      visionModel: VISION_API_ENDPOINT_ID,
      "visionProxy.apiUrl": "https://api.example.com/v1",
      "visionProxy.apiModelId": "gpt-4o",
      "visionProxy.timeoutMs": 1000,
    });

    const service = createService();
    try {
      const first = await service.get();
      assert.notStrictEqual(first, undefined);

      await applySettings({ "visionProxy.timeoutMs": 2000 });

      // The reset runs from the workspace configuration event, which is
      // delivered asynchronously.
      const deadline = Date.now() + 2000;
      let rebuilt = await service.get();
      while (rebuilt === first && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 20));
        rebuilt = await service.get();
      }

      assert.notStrictEqual(
        rebuilt,
        first,
        "changing visionProxy.timeoutMs must reset the cached describer",
      );
    } finally {
      service.dispose();
    }
  });
});
