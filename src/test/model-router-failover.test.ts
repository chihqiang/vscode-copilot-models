/**
 * Tests for router failover behaviour.
 *
 * Two rules are covered:
 * - failover re-sends the whole prompt, so it may only happen while an attempt
 *   has produced nothing. Parts handed to `progress` cannot be retracted, so
 *   switching after partial output would show the start of the response twice.
 * - the failover chain is multi-level (`failoverModels` maps A→B and B→C), so
 *   a third provider must be reachable when B also fails.
 */

import * as assert from "assert";
import * as vscode from "vscode";
import { ModelRouter } from "../core/model-router";
import { ProviderModels } from "../core/provider-models";
import { NetworkError } from "../core/errors";
import { CONFIG_SECTION, type ModelDefinition } from "../core/models";
import type { IModelProvider } from "../core/model-provider";
import type { IChatProvider } from "../core/chat-provider";

const MODEL_A = "model-a";
const MODEL_B = "model-b";
const MODEL_C = "model-c";

function createModels(id: string): ModelDefinition[] {
  return [
    {
      id,
      name: id,
      family: "test",
      version: "1",
      detail: "test",
      maxInputTokens: 1000,
      maxOutputTokens: 100,
      capabilities: { toolCalling: false, imageInput: false, thinking: false },
    },
  ];
}

/** Registry entry so the router can map a model ID to a provider. */
function createModelProvider(id: string, modelId: string): IModelProvider {
  return {
    id,
    config: {
      vendorId: id,
      vendorName: id,
      baseUrl: "https://example.invalid",
      apiKeySecretKey: `${CONFIG_SECTION}.${id}.apiKey`,
    },
    getApiKey: async () => "test-key",
    hasApiKey: async () => true,
    promptForApiKey: async () => false,
    deleteApiKey: async () => {},
    getModels: () => createModels(modelId),
    createClient: () => ({}) as never,
  };
}

type Behaviour = (
  progress: vscode.Progress<vscode.LanguageModelResponsePart>,
) => Promise<void>;

/** Chat provider stub driven by an injected behaviour. */
function createChatProvider(
  id: string,
  behaviour: Behaviour,
  calls: string[],
): IChatProvider {
  return {
    onDidChangeLanguageModelChatInformation: () => ({ dispose: () => {} }),
    provideLanguageModelChatInformation: async () => [],
    provideLanguageModelChatResponse: async (
      ...args: unknown[]
    ): Promise<void> => {
      calls.push(id);
      const progress =
        args[3] as vscode.Progress<vscode.LanguageModelResponsePart>;
      await behaviour(progress);
    },
    provideTokenCount: async () => 0,
    refreshModelPicker: () => {},
    prepareForDeactivate: async () => {},
    dispose: () => {},
  } as unknown as IChatProvider;
}

/** Collects reported parts so tests can assert what the user would see. */
function createProgress(): {
  progress: vscode.Progress<vscode.LanguageModelResponsePart>;
  reported: string[];
} {
  const reported: string[] = [];
  return {
    reported,
    progress: {
      report: (part: vscode.LanguageModelResponsePart) => {
        reported.push(
          part instanceof vscode.LanguageModelTextPart ? part.value : "<part>",
        );
      },
    },
  };
}

function text(value: string): vscode.LanguageModelResponsePart {
  return new vscode.LanguageModelTextPart(value);
}

/** Report the given values, then fail with a transient error. */
function failAfter(...values: string[]): Behaviour {
  return async (progress) => {
    for (const value of values) {
      progress.report(text(value));
    }
    throw new NetworkError("connection reset", "test");
  };
}

function succeedWith(value: string): Behaviour {
  return async (progress) => {
    progress.report(text(value));
  };
}

async function setFailover(models: Record<string, string>): Promise<void> {
  await vscode.workspace
    .getConfiguration(CONFIG_SECTION)
    .update("failoverModels", models, vscode.ConfigurationTarget.Global);
}

suite("ModelRouter failover Test Suite", () => {
  let router: ModelRouter;
  let calls: string[];

  setup(() => {
    calls = [];
    ProviderModels.init([]);
    const registry = ProviderModels.getInstance();
    registry.registerProvider(createModelProvider("p-a", MODEL_A));
    registry.registerProvider(createModelProvider("p-b", MODEL_B));
    registry.registerProvider(createModelProvider("p-c", MODEL_C));
    router = new ModelRouter();
  });

  teardown(async () => {
    router.dispose();
    ProviderModels.getInstance().clear();
    await setFailover({});
  });

  /** Register all three providers with their behaviours, then run once. */
  async function run(
    chain: Record<string, string>,
    map: { a: Behaviour; b: Behaviour; c: Behaviour },
  ): Promise<{ reported: string[]; error: unknown }> {
    router.addProvider("p-a", createChatProvider("p-a", map.a, calls), [
      MODEL_A,
    ]);
    router.addProvider("p-b", createChatProvider("p-b", map.b, calls), [
      MODEL_B,
    ]);
    router.addProvider("p-c", createChatProvider("p-c", map.c, calls), [
      MODEL_C,
    ]);
    await setFailover(chain);

    const { progress, reported } = createProgress();
    let error: unknown;
    try {
      await router.provideLanguageModelChatResponse(
        { id: MODEL_A } as vscode.LanguageModelChatInformation,
        [],
        {} as vscode.ProvideLanguageModelChatResponseOptions,
        progress,
        { isCancellationRequested: false } as vscode.CancellationToken,
      );
    } catch (e) {
      error = e;
    }
    return { reported, error };
  }

  test("fails over when the primary produced no output", async () => {
    const { reported, error } = await run(
      { [MODEL_A]: MODEL_B },
      { a: failAfter(), b: succeedWith("from b"), c: succeedWith("from c") },
    );

    assert.strictEqual(error, undefined);
    assert.deepStrictEqual(calls, ["p-a", "p-b"]);
    assert.deepStrictEqual(reported, ["from b"]);
  });

  test("continues the chain when the first fallback also fails", async () => {
    // A→B and B→C: reaching C requires chaining the lookup from the model that
    // just failed. Resolving A's mapping again would stop at B.
    const { reported, error } = await run(
      { [MODEL_A]: MODEL_B, [MODEL_B]: MODEL_C },
      { a: failAfter(), b: failAfter(), c: succeedWith("from c") },
    );

    assert.strictEqual(error, undefined);
    assert.deepStrictEqual(calls, ["p-a", "p-b", "p-c"]);
    assert.deepStrictEqual(reported, ["from c"]);
  });

  test("does not fail over after the primary already streamed output", async () => {
    const { reported, error } = await run(
      { [MODEL_A]: MODEL_B },
      {
        a: failAfter("partial answer"),
        b: succeedWith("from b"),
        c: succeedWith("from c"),
      },
    );

    assert.ok(error, "the failure must surface instead of being papered over");
    assert.deepStrictEqual(
      calls,
      ["p-a"],
      "re-sending the prompt would duplicate the visible partial answer",
    );
    assert.deepStrictEqual(reported, ["partial answer"]);
  });

  test("stops the chain when a fallback emitted output before failing", async () => {
    const { reported, error } = await run(
      { [MODEL_A]: MODEL_B, [MODEL_B]: MODEL_C },
      {
        a: failAfter(),
        b: failAfter("partial from b"),
        c: succeedWith("from c"),
      },
    );

    assert.ok(error);
    assert.deepStrictEqual(
      calls,
      ["p-a", "p-b"],
      "no third attempt, since the second already streamed",
    );
    assert.deepStrictEqual(reported, ["partial from b"]);
  });

  test("does not fail over on a non-transient error", async () => {
    const { error } = await run(
      { [MODEL_A]: MODEL_B },
      {
        a: async () => {
          throw new Error("invalid model id");
        },
        b: succeedWith("from b"),
        c: succeedWith("from c"),
      },
    );

    assert.ok(error);
    assert.deepStrictEqual(calls, ["p-a"]);
  });

  test("gives up when no failover mapping exists", async () => {
    const { error } = await run(
      {},
      { a: failAfter(), b: succeedWith("from b"), c: succeedWith("from c") },
    );

    assert.ok(error);
    assert.deepStrictEqual(calls, ["p-a"]);
  });

  test("does not revisit a provider already tried", async () => {
    // B maps back to A, which was already attempted.
    const { error } = await run(
      { [MODEL_A]: MODEL_B, [MODEL_B]: MODEL_A },
      { a: failAfter(), b: failAfter(), c: succeedWith("from c") },
    );

    assert.ok(error);
    assert.deepStrictEqual(calls, ["p-a", "p-b"]);
  });
});
