/**
 * Tests for API error construction.
 *
 * `createApiError` picks the error type from the HTTP status and has to place
 * the human-readable message and the raw body in the right parameters. Those
 * two were once named the other way round relative to what callers passed, so
 * the names are asserted here alongside the mapping.
 */

import * as assert from "assert";
import {
  ApiError,
  AuthenticationError,
  createApiError,
  NotFoundError,
  PayloadTooLargeError,
  PermissionError,
  RateLimitError,
  ServiceUnavailableError,
  UnsupportedMediaTypeError,
} from "../core/errors";

const PROVIDER = "test-provider";
const RAW_BODY = '{"error":{"message":"server says no"}}';
const MESSAGE = "server says no";

suite("createApiError Test Suite", () => {
  test("maps the documented statuses to typed errors", () => {
    const cases: Array<[number, string]> = [
      [401, "AuthenticationError"],
      [403, "PermissionError"],
      [404, "NotFoundError"],
      [413, "PayloadTooLargeError"],
      [415, "UnsupportedMediaTypeError"],
      [429, "RateLimitError"],
      [503, "ServiceUnavailableError"],
    ];

    for (const [status, expectedName] of cases) {
      const error = createApiError(status, PROVIDER, MESSAGE, RAW_BODY);
      assert.ok(
        error instanceof ApiError,
        `status ${status} must be an ApiError`,
      );
      assert.strictEqual(
        error.name,
        expectedName,
        `status ${status} should produce ${expectedName}`,
      );
      assert.strictEqual(error.statusCode, status);
      assert.strictEqual(error.providerId, PROVIDER);
    }
  });

  test("does not expose the raw body on typed errors", () => {
    // The typed errors carry a fixed user-facing sentence. Keeping the raw
    // response body on the object was write-only state: nothing read it, and
    // these classes are handed straight to the UI.
    const error = createApiError(401, PROVIDER, MESSAGE, RAW_BODY);
    assert.ok(!error.message.includes(RAW_BODY));
    assert.ok(!("responseBody" in error));
  });

  test("includes the server message for an unmapped status", () => {
    // Nothing else carries the server's explanation for these, so it has to be
    // in the message — and it must be the message, not the raw body.
    const error = createApiError(418, PROVIDER, MESSAGE, RAW_BODY);

    assert.strictEqual(error.name, "ApiError");
    assert.ok(
      error.message.includes(MESSAGE),
      `expected the server message in "${error.message}"`,
    );
    assert.ok(
      !error.message.includes(RAW_BODY),
      "the raw body must not be inlined when a message was extracted",
    );
  });

  test("falls back to the raw body when no message was extracted", () => {
    const error = createApiError(418, PROVIDER, "", RAW_BODY);
    assert.ok(error.message.includes(RAW_BODY));
  });

  test("keeps the server-requested delay on a rate limit", () => {
    const limited = createApiError(429, PROVIDER, MESSAGE, RAW_BODY, 5_000);
    assert.ok(limited instanceof RateLimitError);
    assert.strictEqual(limited.retryAfterMs, 5_000);
    assert.ok(
      limited.message.includes("5 second"),
      `expected the delay in "${limited.message}"`,
    );

    // The delay is only meaningful for a 429; passing one with another status
    // must not turn it into a rate-limit error.
    const serverError = createApiError(500, PROVIDER, MESSAGE, RAW_BODY, 5_000);
    assert.ok(!(serverError instanceof RateLimitError));
    assert.strictEqual(serverError.statusCode, 500);
  });

  test("classifies 4xx as client errors and 5xx as server errors", () => {
    assert.strictEqual(
      createApiError(401, PROVIDER, MESSAGE, RAW_BODY).isClientError,
      true,
    );
    assert.strictEqual(
      createApiError(503, PROVIDER, MESSAGE, RAW_BODY).isServerError,
      true,
    );
  });
});
