import * as assert from "assert";
import { getEventListeners } from "node:events";
import {
  CircuitBreaker,
  CircuitBreakerError,
  CircuitState,
} from "../core/circuit-breaker";
import { delay, calculateDelay, parseRetryAfter } from "../core/retry";

const TEST_PROVIDER = "test-provider";

suite("CircuitBreaker Test Suite", () => {
  test("initial state is CLOSED", () => {
    const cb = new CircuitBreaker();
    assert.strictEqual(cb.getState(), CircuitState.CLOSED);
  });

  test("tolerates failures below threshold", async () => {
    const cb = new CircuitBreaker({ failureThreshold: 3, resetTimeoutMs: 0 });
    const failingFn = async () => {
      throw new Error("fail");
    };

    for (let i = 0; i < 2; i++) {
      await assert.rejects(() => cb.call(TEST_PROVIDER, failingFn));
      assert.strictEqual(cb.getState(), CircuitState.CLOSED);
    }
  });

  test("opens after reaching failure threshold", async () => {
    const cb = new CircuitBreaker({
      failureThreshold: 2,
      resetTimeoutMs: 50000,
    });
    const failingFn = async () => {
      throw new Error("fail");
    };

    await assert.rejects(() => cb.call(TEST_PROVIDER, failingFn));
    assert.strictEqual(cb.getState(), CircuitState.CLOSED);

    await assert.rejects(() => cb.call(TEST_PROVIDER, failingFn));
    assert.strictEqual(cb.getState(), CircuitState.OPEN);
  });

  test("throws CircuitBreakerError when OPEN", async () => {
    const cb = new CircuitBreaker({
      failureThreshold: 1,
      resetTimeoutMs: 50000,
    });
    const failingFn = async () => {
      throw new Error("fail");
    };

    await assert.rejects(() => cb.call(TEST_PROVIDER, failingFn));

    await assert.rejects(
      () => cb.call(TEST_PROVIDER, failingFn),
      (err: unknown) => err instanceof CircuitBreakerError,
    );
  });

  test("transitions HALF_OPEN after reset timeout", async () => {
    const cb = new CircuitBreaker({ failureThreshold: 1, resetTimeoutMs: 0 });
    const failingFn = async () => {
      throw new Error("fail");
    };
    const successFn = async () => "ok";

    await assert.rejects(() => cb.call(TEST_PROVIDER, failingFn));
    assert.strictEqual(cb.getState(), CircuitState.OPEN);

    const result = await cb.call(TEST_PROVIDER, successFn);
    assert.strictEqual(result, "ok");
    assert.strictEqual(cb.getState(), CircuitState.CLOSED);
  });

  test("reset() restores CLOSED state", async () => {
    const cb = new CircuitBreaker({
      failureThreshold: 1,
      resetTimeoutMs: 50000,
    });
    const failingFn = async () => {
      throw new Error("fail");
    };

    await assert.rejects(() => cb.call(TEST_PROVIDER, failingFn));
    assert.strictEqual(cb.getState(), CircuitState.OPEN);

    cb.reset();
    assert.strictEqual(cb.getState(), CircuitState.CLOSED);

    const successFn = async () => "ok";
    assert.strictEqual(await cb.call(TEST_PROVIDER, successFn), "ok");
  });

  test("recovers after success in HALF_OPEN", async () => {
    const cb = new CircuitBreaker({ failureThreshold: 1, resetTimeoutMs: 0 });
    const alternating = (() => {
      let first = true;
      return async () => {
        if (first) {
          first = false;
          throw new Error("fail");
        }
        return "ok";
      };
    })();

    await assert.rejects(() => cb.call(TEST_PROVIDER, alternating));
    assert.strictEqual(await cb.call(TEST_PROVIDER, alternating), "ok");
    assert.strictEqual(cb.getState(), CircuitState.CLOSED);

    const successFn = async () => "still ok";
    assert.strictEqual(await cb.call(TEST_PROVIDER, successFn), "still ok");
  });
});

suite("CircuitBreaker countable-failure Test Suite", () => {
  const failingFn = async (): Promise<string> => {
    throw new Error("provider rejected the request");
  };

  test("does not open on failures the caller excluded", async () => {
    const cb = new CircuitBreaker({ failureThreshold: 2, resetTimeoutMs: 0 });
    const excluded = { isCountableFailure: () => false };

    // Well past the threshold: none of these reflect provider health.
    for (let i = 0; i < 5; i++) {
      await assert.rejects(() => cb.call(TEST_PROVIDER, failingFn, excluded));
    }

    assert.strictEqual(
      cb.getState(),
      CircuitState.CLOSED,
      "excluded failures must not open the circuit",
    );
  });

  test("rethrows the original error rather than a CircuitBreakerError", async () => {
    // The point of excluding a failure is that the caller sees the real
    // problem. If the circuit opened anyway, the actionable error would be
    // replaced by "Circuit breaker OPEN".
    const cb = new CircuitBreaker({ failureThreshold: 1, resetTimeoutMs: 0 });
    const excluded = { isCountableFailure: () => false };

    for (let i = 0; i < 3; i++) {
      await assert.rejects(
        () => cb.call(TEST_PROVIDER, failingFn, excluded),
        (err: unknown) =>
          err instanceof Error &&
          err.message === "provider rejected the request",
      );
    }
  });

  test("still opens on failures the caller counts", async () => {
    // Control for the two tests above: the predicate must not disable the
    // breaker outright, or "did not open" would prove nothing.
    const cb = new CircuitBreaker({
      failureThreshold: 2,
      resetTimeoutMs: 50_000,
    });
    const counted = { isCountableFailure: () => true };

    await assert.rejects(() => cb.call(TEST_PROVIDER, failingFn, counted));
    assert.strictEqual(cb.getState(), CircuitState.CLOSED);

    await assert.rejects(() => cb.call(TEST_PROVIDER, failingFn, counted));
    assert.strictEqual(cb.getState(), CircuitState.OPEN);

    await assert.rejects(
      () => cb.call(TEST_PROVIDER, failingFn, counted),
      (err: unknown) => err instanceof CircuitBreakerError,
    );
  });

  test("counts every failure when no predicate is supplied", async () => {
    const cb = new CircuitBreaker({
      failureThreshold: 1,
      resetTimeoutMs: 50_000,
    });

    await assert.rejects(() => cb.call(TEST_PROVIDER, failingFn));

    assert.strictEqual(cb.getState(), CircuitState.OPEN);
  });
});

suite("CircuitBreaker half-open Test Suite", () => {
  test("admits exactly one probe at a time", async () => {
    const cb = new CircuitBreaker({ failureThreshold: 1, resetTimeoutMs: 0 });
    const failingFn = async (): Promise<string> => {
      throw new Error("fail");
    };
    await assert.rejects(() => cb.call(TEST_PROVIDER, failingFn));
    assert.strictEqual(cb.getState(), CircuitState.OPEN);

    // resetTimeoutMs is 0, so this request becomes the half-open probe and
    // stays in flight until released.
    let releaseProbe!: () => void;
    const probe = cb.call(
      TEST_PROVIDER,
      () =>
        new Promise<string>((resolve) => {
          releaseProbe = () => resolve("recovered");
        }),
    );
    assert.strictEqual(cb.getState(), CircuitState.HALF_OPEN);

    // A concurrent request must be rejected while the probe is unresolved,
    // rather than piling onto a provider that has not proven itself.
    await assert.rejects(
      () => cb.call(TEST_PROVIDER, async () => "other"),
      (err: unknown) => err instanceof CircuitBreakerError,
    );

    releaseProbe();
    assert.strictEqual(await probe, "recovered");
    assert.strictEqual(cb.getState(), CircuitState.CLOSED);
  });

  test("releases the probe slot once the probe settles", async () => {
    const cb = new CircuitBreaker({ failureThreshold: 1, resetTimeoutMs: 0 });
    const failingFn = async (): Promise<string> => {
      throw new Error("fail");
    };
    await assert.rejects(() => cb.call(TEST_PROVIDER, failingFn));

    // A probe that fails must free the slot, so the next attempt can retry
    // rather than being locked out forever by a stale in-flight marker.
    await assert.rejects(() => cb.call(TEST_PROVIDER, failingFn));
    assert.strictEqual(cb.getState(), CircuitState.OPEN);

    const settled = await cb.call(TEST_PROVIDER, async () => "recovered");
    assert.strictEqual(settled, "recovered");
    assert.strictEqual(cb.getState(), CircuitState.CLOSED);
  });

  test("a cancelled probe does not open the circuit", async () => {
    const cb = new CircuitBreaker({ failureThreshold: 1, resetTimeoutMs: 0 });
    const failingFn = async (): Promise<string> => {
      throw new Error("fail");
    };
    await assert.rejects(() => cb.call(TEST_PROVIDER, failingFn));
    assert.strictEqual(cb.getState(), CircuitState.OPEN);

    // The probe proves nothing when the caller walked away, so the circuit
    // stays half-open and the next request may probe instead.
    await assert.rejects(() =>
      cb.call(TEST_PROVIDER, failingFn, { isCountableFailure: () => false }),
    );
    assert.strictEqual(cb.getState(), CircuitState.HALF_OPEN);

    const settled = await cb.call(TEST_PROVIDER, async () => "recovered");
    assert.strictEqual(settled, "recovered");
    assert.strictEqual(cb.getState(), CircuitState.CLOSED);
  });
});

suite("calculateDelay Test Suite", () => {
  test("returns at least base delay for attempt 0", () => {
    const delay1 = calculateDelay(0);
    assert.ok(delay1 >= 1000, `Expected >= 1000, got ${delay1}`);
  });

  test("increases exponentially with attempt", () => {
    const delay0 = calculateDelay(0, {
      baseDelayMs: 1000,
      maxDelayMs: 100000,
      jitterMs: 0,
    });
    const delay1 = calculateDelay(1, {
      baseDelayMs: 1000,
      maxDelayMs: 100000,
      jitterMs: 0,
    });
    const delay2 = calculateDelay(2, {
      baseDelayMs: 1000,
      maxDelayMs: 100000,
      jitterMs: 0,
    });

    assert.ok(
      delay1 >= delay0 * 1.5,
      `delay1=${delay1} should be >= delay0*1.5=${delay0 * 1.5}`,
    );
    assert.ok(
      delay2 >= delay1 * 1.5,
      `delay2=${delay2} should be >= delay1*1.5=${delay1 * 1.5}`,
    );
  });

  test("caps at maxDelayMs", () => {
    const delay100 = calculateDelay(100, {
      baseDelayMs: 1000,
      maxDelayMs: 5000,
      jitterMs: 0,
    });
    assert.ok(delay100 <= 5000, `Expected <= 5000, got ${delay100}`);
  });

  test("uses custom config", () => {
    const d = calculateDelay(0, {
      baseDelayMs: 500,
      maxDelayMs: 10000,
      jitterMs: 0,
    });
    assert.ok(d >= 500 && d <= 500);
  });

  test("adds jitter", () => {
    const delays = Array.from({ length: 20 }, () =>
      calculateDelay(0, { baseDelayMs: 1000, maxDelayMs: 5000, jitterMs: 500 }),
    );
    const unique = new Set(delays);
    assert.ok(unique.size > 1, "jitter should produce varying delays");
  });
});

suite("parseRetryAfter Test Suite", () => {
  test("parses the delay-seconds form", () => {
    assert.strictEqual(parseRetryAfter("5"), 5_000);
    assert.strictEqual(parseRetryAfter("0"), 0);
    assert.strictEqual(parseRetryAfter(" 12 "), 12_000);
  });

  test("parses the HTTP-date form relative to now", () => {
    const now = Date.parse("2026-09-10T00:00:00Z");
    const value = new Date(now + 30_000).toUTCString();

    assert.strictEqual(parseRetryAfter(value, now), 30_000);
  });

  test("treats a past date as retry-now rather than negative", () => {
    const now = Date.parse("2026-09-10T00:00:00Z");
    const value = new Date(now - 60_000).toUTCString();

    assert.strictEqual(parseRetryAfter(value, now), 0);
  });

  test("returns undefined for absent or unparseable values", () => {
    assert.strictEqual(parseRetryAfter(null), undefined);
    assert.strictEqual(parseRetryAfter(undefined), undefined);
    assert.strictEqual(parseRetryAfter(""), undefined);
    assert.strictEqual(parseRetryAfter("   "), undefined);
    assert.strictEqual(parseRetryAfter("soon"), undefined);
    assert.strictEqual(parseRetryAfter("-5"), undefined);
  });

  test("rejects values Date.parse would leniently accept", () => {
    // Date.parse reads "-5" as a year and "0.5" as a date. Treating those as
    // valid would turn a malformed header into "retry now", hammering a server
    // that asked us to back off. Bare integers are NOT in this list: the spec
    // defines delay-seconds as any non-negative integer, so "2026" legitimately
    // means 2026 seconds (the caller caps it).
    for (const value of ["-5", "0.5", "null", "1e3", "+7"]) {
      assert.strictEqual(
        parseRetryAfter(value),
        undefined,
        `"${value}" is not a valid Retry-After`,
      );
    }
  });

  test("accepts a large delay-seconds value, leaving capping to the caller", () => {
    assert.strictEqual(parseRetryAfter("2026"), 2_026_000);
  });
});

suite("delay Test Suite", () => {
  test("resolves after specified time", async () => {
    const start = Date.now();
    await delay(10);
    const elapsed = Date.now() - start;
    assert.ok(elapsed >= 5, `Expected >= 5ms, got ${elapsed}ms`);
  });

  /**
   * The contract callers actually depend on.
   *
   * `classifyError` maps an abort to `CancelledError` via
   * `error instanceof Error && error.name === "AbortError"`, and
   * `isAbortError` (sse.ts) matches the same name. Asserting the concrete
   * class instead pinned the implementation rather than the interface:
   * `node:timers/promises` rejects with a plain `Error` subclass, which
   * satisfies both predicates but is not a `DOMException`.
   */
  function isAbortError(err: unknown): boolean {
    return err instanceof Error && err.name === "AbortError";
  }

  test("rejects when the signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();

    await assert.rejects(() => delay(10, controller.signal), isAbortError);
  });

  test("rejects when aborted mid-delay", async () => {
    const controller = new AbortController();
    const pending = delay(10_000, controller.signal);
    controller.abort();

    await assert.rejects(() => pending, isAbortError);
  });

  test("rejects without waiting out the delay when aborted mid-delay", async () => {
    // Aborting must short-circuit the remaining wait, not merely mark it:
    // retries share a signal, so a cancelled request that still slept for the
    // full backoff would keep the extension busy after the user gave up.
    const controller = new AbortController();
    const start = Date.now();
    const pending = delay(30_000, controller.signal);
    controller.abort();

    await assert.rejects(() => pending, isAbortError);
    assert.ok(
      Date.now() - start < 5_000,
      "abort must not wait for the full delay",
    );
  });

  test("detaches its abort listener once the delay resolves", async () => {
    const controller = new AbortController();
    await delay(5, controller.signal);

    assert.strictEqual(
      getEventListeners(controller.signal, "abort").length,
      0,
      "abort listener must be removed on the happy path",
    );
  });

  test("leaves no abort listener behind after an abort", async () => {
    const controller = new AbortController();
    const pending = delay(30_000, controller.signal).catch(() => {});
    controller.abort();
    await pending;

    assert.strictEqual(
      getEventListeners(controller.signal, "abort").length,
      0,
      "the abort path must clean up in both directions too",
    );
  });

  test("does not accumulate abort listeners across retries", async () => {
    // Retries share one AbortSignal, so a leak would pile up listeners until
    // Node emits its MaxListenersExceededWarning.
    const controller = new AbortController();
    for (let i = 0; i < 15; i++) {
      await delay(1, controller.signal);
    }

    assert.strictEqual(
      getEventListeners(controller.signal, "abort").length,
      0,
      "listener count must stay at zero regardless of retry count",
    );
  });
});
