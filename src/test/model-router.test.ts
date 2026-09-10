/**
 * Regression tests for failover error classification.
 *
 * `isTransientError` decides whether the router walks the fallback chain or
 * surfaces the error to the user. An open circuit breaker must count as
 * transient, otherwise a temporarily unhealthy provider takes the whole
 * request down even though a healthy fallback exists.
 */

import * as assert from "assert";
import { isTransientError } from "../core/model-router";
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
