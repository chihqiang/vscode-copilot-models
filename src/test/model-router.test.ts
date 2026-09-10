/**
 * Regression tests for failover error classification.
 *
 * `isTransientError` decides whether the router walks the fallback chain or
 * surfaces the error to the user. An open circuit breaker must count as
 * transient, otherwise a temporarily unhealthy provider takes the whole
 * request down even though a healthy fallback exists.
 */

import * as assert from "assert";
import * as vscode from "vscode";
import { isTransientError, ModelRouter } from "../core/model-router";
import { CircuitBreakerError } from "../core/circuit-breaker";
import {
  AuthenticationError,
  NetworkError,
  PermissionError,
  RateLimitError,
  ServiceUnavailableError,
  TimeoutError,
} from "../core/errors";

const PROVIDER = "test-provider";

suite("isTransientError Test Suite", () => {
  test("treats an open circuit breaker as transient", () => {
    assert.strictEqual(
      isTransientError(new CircuitBreakerError(PROVIDER)),
      true,
    );
  });

  test("treats typed transport errors as transient", () => {
    assert.strictEqual(isTransientError(new RateLimitError(PROVIDER)), true);
    assert.strictEqual(
      isTransientError(new ServiceUnavailableError(PROVIDER)),
      true,
    );
    assert.strictEqual(
      isTransientError(new NetworkError("socket hang up", PROVIDER)),
      true,
    );
    assert.strictEqual(
      isTransientError(new TimeoutError(PROVIDER, 1000)),
      true,
    );
  });

  test("recognises transient messages on plain errors", () => {
    assert.strictEqual(isTransientError(new Error("request timeout")), true);
    assert.strictEqual(
      isTransientError(new Error("connect ECONNREFUSED")),
      true,
    );
    assert.strictEqual(
      isTransientError(new Error("429 Too Many Requests")),
      true,
    );
  });

  test("does not fail over on caller mistakes", () => {
    assert.strictEqual(
      isTransientError(new AuthenticationError(PROVIDER)),
      false,
    );
    assert.strictEqual(isTransientError(new PermissionError(PROVIDER)), false);
    assert.strictEqual(isTransientError(new Error("invalid model id")), false);
    assert.strictEqual(isTransientError("not an error"), false);
    assert.strictEqual(isTransientError(undefined), false);
  });
});

suite("ModelRouter token count fallback Test Suite", () => {
  function modelInfo(id: string): vscode.LanguageModelChatInformation {
    return {
      id,
      name: id,
      family: "test",
      version: "1",
      maxInputTokens: 1000,
      maxOutputTokens: 100,
    } as vscode.LanguageModelChatInformation;
  }

  function createToken(): vscode.CancellationToken {
    return new vscode.CancellationTokenSource().token;
  }

  test("estimates rather than reporting zero for an unknown model", async () => {
    // The router is the provider VS Code talks to, so its answer is the one
    // that decides whether a context still fits. It used to answer 0 when it
    // could not resolve the model — which reads as "this prompt costs nothing"
    // and can let an over-long context through.
    const router = new ModelRouter();
    try {
      const text = "the quick brown fox ".repeat(200);
      const count = await router.provideTokenCount(
        modelInfo("model-that-is-not-registered"),
        text,
        createToken(),
      );

      assert.ok(
        count > 0,
        `an unresolvable model must still get an estimate, got ${count}`,
      );
    } finally {
      router.dispose();
    }
  });

  test("estimates a message, not just a string", async () => {
    const router = new ModelRouter();
    try {
      const message = vscode.LanguageModelChatMessage.User(
        "the quick brown fox ".repeat(200),
      );
      const count = await router.provideTokenCount(
        modelInfo("model-that-is-not-registered"),
        message,
        createToken(),
      );

      assert.ok(count > 0, `expected a positive estimate, got ${count}`);
    } finally {
      router.dispose();
    }
  });
});
