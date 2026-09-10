/**
 * Regression tests for how the API client feeds the circuit breaker.
 *
 * These go through a real `createApiClient` rather than driving
 * `CircuitBreaker` directly: the breaker is constructed inside the client, so
 * a test of the breaker alone would still pass if the client stopped passing
 * its countable-failure predicate.
 *
 * The breaker exists to stop hammering an unhealthy provider. Counting every
 * failure made it open on errors that say nothing about provider health, so the
 * real error was replaced by "Circuit breaker OPEN" — and because every
 * half-open probe failed the same way, the circuit re-opened indefinitely.
 *
 * Several assertions count fetch calls as well as inspecting the reported
 * error. An open circuit rejects the request before it reaches the provider, so
 * the call count is a direct observation of the breaker's state. The reported
 * error alone is not always enough: a cancelled request is reported as
 * `CancelledError` whatever went wrong underneath, which would hide a circuit
 * that had opened.
 */

import * as assert from "assert";
import * as vscode from "vscode";
import {
  createApiClient,
  type ApiRequest,
  type IApiClient,
} from "../core/client";
import {
  AuthenticationError,
  CancelledError,
  ServiceUnavailableError,
} from "../core/errors";
import { CircuitBreakerError } from "../core/circuit-breaker";

const PROVIDER = "test-provider";

/**
 * Threshold of 2 makes the two behaviours easy to tell apart: if a failure
 * counts, the third request is rejected by the breaker instead of reaching the
 * provider.
 */
const FAILURE_THRESHOLD = 2;

/** Attempts beyond the threshold, so an opening circuit has room to show. */
const ATTEMPTS = FAILURE_THRESHOLD + 3;

const REQUEST: ApiRequest = {
  model: "test-model",
  messages: [{ role: "user", content: "hello" }],
  stream: true,
};

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/**
 * Stand-in for `fetch` that answers with a fixed status, honouring an aborted
 * signal the way the real implementation does (reject with the abort reason).
 */
function stubFetch(status: number, onCall: () => void): typeof fetch {
  return (async (_url: string, init?: RequestInit) => {
    onCall();
    const signal = init?.signal;
    if (signal?.aborted) {
      throw signal.reason ?? new DOMException("Aborted", "AbortError");
    }
    return jsonResponse(status, { error: { message: "stub response" } });
  }) as unknown as typeof fetch;
}

function createClient(): IApiClient {
  return createApiClient({
    baseUrl: "https://api.example.com",
    apiKey: "sk-test",
    providerName: PROVIDER,
    timeoutMs: 5_000,
    maxRetries: 0,
    circuitBreaker: {
      failureThreshold: FAILURE_THRESHOLD,
      resetTimeoutMs: 60_000,
    },
  });
}

/** Send one request and return the error handed to `onError`. */
async function sendOnce(
  client: IApiClient,
  token?: vscode.CancellationToken,
): Promise<Error> {
  let captured: Error | undefined;
  await client.streamChatCompletion(
    REQUEST,
    {
      onContent: () => {},
      onThinking: () => {},
      onToolCall: () => {},
      onDone: () => {},
      onError: (error) => {
        captured = error;
      },
    },
    token,
  );

  assert.ok(captured, "the request must report an error");
  return captured;
}

interface RepeatedResult {
  errors: Error[];
  /** How many requests actually reached the provider. */
  providerCalls: number;
}

/** Run `ATTEMPTS` requests against a fetch stub with a fixed status. */
async function sendRepeatedly(
  status: number,
  token?: vscode.CancellationToken,
): Promise<RepeatedResult> {
  const original = globalThis.fetch;
  let providerCalls = 0;
  globalThis.fetch = stubFetch(status, () => {
    providerCalls++;
  });

  try {
    const client = createClient();
    const errors: Error[] = [];
    for (let i = 0; i < ATTEMPTS; i++) {
      errors.push(await sendOnce(client, token));
    }
    return { errors, providerCalls };
  } finally {
    globalThis.fetch = original;
  }
}

suite("Circuit breaker wiring Test Suite", () => {
  test("a server error opens the circuit", async () => {
    // Control. Without this, "the circuit did not open" below would also pass
    // if the breaker were broken outright.
    const { errors, providerCalls } = await sendRepeatedly(503);

    for (let i = 0; i < FAILURE_THRESHOLD; i++) {
      assert.ok(
        errors[i] instanceof ServiceUnavailableError,
        `request ${i + 1} should surface the provider's 503, got ${errors[i].name}`,
      );
    }
    assert.strictEqual(
      providerCalls,
      FAILURE_THRESHOLD,
      "later requests must be blocked before reaching the provider",
    );
    assert.ok(
      errors[FAILURE_THRESHOLD] instanceof CircuitBreakerError,
      `request ${FAILURE_THRESHOLD + 1} should be blocked by the open circuit, got ${errors[FAILURE_THRESHOLD].name}`,
    );
  });

  test("a wrong API key never opens the circuit", async () => {
    const { errors, providerCalls } = await sendRepeatedly(401);

    for (let i = 0; i < ATTEMPTS; i++) {
      assert.ok(
        errors[i] instanceof AuthenticationError,
        `request ${i + 1} must report the auth failure, got ${errors[i].name}: ${errors[i].message}`,
      );
    }
    assert.strictEqual(
      providerCalls,
      ATTEMPTS,
      "every request must reach the provider: a bad key is not an outage",
    );
  });

  test("a rejected request (4xx) never opens the circuit", async () => {
    // 400 is a request-shape problem: the provider answered, so it is up.
    const { errors, providerCalls } = await sendRepeatedly(400);

    for (let i = 0; i < ATTEMPTS; i++) {
      assert.strictEqual(
        errors[i] instanceof CircuitBreakerError,
        false,
        `request ${i + 1} must surface the provider's 400, not a blocked circuit`,
      );
    }
    assert.strictEqual(providerCalls, ATTEMPTS);
  });

  test("cancelling a request never opens the circuit", async () => {
    const source = new vscode.CancellationTokenSource();
    source.cancel();
    try {
      const { errors, providerCalls } = await sendRepeatedly(200, source.token);

      for (let i = 0; i < ATTEMPTS; i++) {
        assert.ok(
          errors[i] instanceof CancelledError,
          `request ${i + 1} must report cancellation, got ${errors[i].name}`,
        );
      }
      // The discriminating assertion: once the token is cancelled the client
      // reports CancelledError for whatever failed, so the errors above look
      // the same whether or not the circuit opened. Only the call count shows
      // it.
      assert.strictEqual(
        providerCalls,
        ATTEMPTS,
        "a cancelled request is not evidence of an outage, so the circuit must stay closed",
      );
    } finally {
      source.dispose();
    }
  });
});
