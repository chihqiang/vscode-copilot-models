/**
 * Regression tests for router lookups when the provider registry has no
 * instance.
 *
 * `findProviderForModel` resolved through `ProviderModels.getInstance()`, a
 * strict singleton that throws until `init()` has run — and that the test
 * suites reset between cases. Both of its callers already have an answer for
 * "no provider": `provideTokenCount` estimates locally, and
 * `provideLanguageModelChatResponse` reports the model as unroutable. The
 * throw replaced that answer with `Singleton not initialized`, which names the
 * internal state rather than the problem.
 *
 * Production reaches this less easily than the token-plan equivalent did —
 * activation initialises the registry before registering the router, and
 * `deactivate()` clears it instead of resetting it — so these tests pin the
 * behaviour rather than reproduce a release-blocking failure. `deactivate()`
 * guarding the same hazard is what makes the asymmetry worth removing.
 */

import * as assert from "assert";
import * as vscode from "vscode";
import { ModelRouter } from "../core/model-router";
import { ProviderModels } from "../core/provider-models";

const MODEL_ID = "some-model";

function createToken(): vscode.CancellationToken {
  return new vscode.CancellationTokenSource().token;
}

const MODEL_INFO = {
  id: MODEL_ID,
  name: MODEL_ID,
  family: "test",
  version: "1",
  maxInputTokens: 1000,
  maxOutputTokens: 100,
} as vscode.LanguageModelChatInformation;

suite("router without a provider registry Test Suite", () => {
  let router: ModelRouter;

  setup(() => {
    // Explicit: the point is that this state is reachable at any time, not
    // that some other suite happened to leave it behind.
    ProviderModels.resetInstance();
    router = new ModelRouter();
  });

  teardown(() => {
    router.dispose();
  });

  test("the registry really is uninitialized", () => {
    // Guards the premise: if this ever fails, the tests below prove nothing.
    assert.strictEqual(ProviderModels.isInitialized(), false);
    assert.strictEqual(ProviderModels.getOptional(), undefined);
  });

  test("a token count falls back to a local estimate", async () => {
    const count = await router.provideTokenCount(
      MODEL_INFO,
      "the quick brown fox",
      createToken(),
    );

    assert.ok(
      count > 0,
      "an unroutable model must still yield a usable count, not an exception",
    );
  });

  test("a chat request reports the model as unroutable", async () => {
    // The router's own diagnostic, which says what is actually wrong.
    await assert.rejects(
      () =>
        router.provideLanguageModelChatResponse(
          MODEL_INFO,
          [] as unknown as vscode.LanguageModelChatRequestMessage[],
          {} as vscode.ProvideLanguageModelChatResponseOptions,
          { report: () => {} },
          createToken(),
        ),
      (error: Error) => {
        assert.ok(
          error.message.includes("No provider found"),
          `expected the router's own diagnostic, got "${error.message}"`,
        );
        return true;
      },
    );
  });

  test("the strict accessor still throws, so the distinction is deliberate", () => {
    // The wizards and the activation sequence must not run without a registry,
    // and they keep the loud failure.
    assert.throws(
      () => ProviderModels.getInstance(),
      /Singleton not initialized/,
    );
  });
});

suite("router with an emptied registry Test Suite", () => {
  test("a cleared registry reports the model as unroutable", async () => {
    // What `deactivate()` leaves behind: an instance that exists but holds
    // nothing. Distinct from the uninitialized case, and it must not throw
    // either.
    ProviderModels.init([]);
    const router = new ModelRouter();

    try {
      await assert.rejects(
        () =>
          router.provideLanguageModelChatResponse(
            MODEL_INFO,
            [] as unknown as vscode.LanguageModelChatRequestMessage[],
            {} as vscode.ProvideLanguageModelChatResponseOptions,
            { report: () => {} },
            createToken(),
          ),
        (error: Error) => error.message.includes("No provider found"),
      );
    } finally {
      router.dispose();
      ProviderModels.resetInstance();
    }
  });
});
