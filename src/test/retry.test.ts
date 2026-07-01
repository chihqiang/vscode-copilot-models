import * as assert from "assert";
import {
  CircuitBreaker,
  CircuitBreakerError,
  CircuitState,
} from "../core/circuit-breaker";
import { delay, calculateDelay } from "../core/retry";

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

suite("delay Test Suite", () => {
  test("resolves after specified time", async () => {
    const start = Date.now();
    await delay(10);
    const elapsed = Date.now() - start;
    assert.ok(elapsed >= 5, `Expected >= 5ms, got ${elapsed}ms`);
  });
});
