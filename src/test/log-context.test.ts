import * as assert from "assert";
import {
  withLogContext,
  getLogContext,
  generateRequestId,
} from "../core/logger";

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

suite("LogContext (AsyncLocalStorage)", () => {
  test("propagates context through async/await chain", async () => {
    const ctx = { requestId: "abc123", providerId: "deepseek", modelId: "m1" };
    let observed: unknown;
    await withLogContext(ctx, async () => {
      await delay(5);
      observed = getLogContext();
    });
    assert.deepStrictEqual(observed, ctx);
  });

  test("isolates concurrent requests", async () => {
    const results: string[] = [];
    const run = async (id: string, ms: number) =>
      withLogContext({ requestId: id }, async () => {
        await delay(ms);
        results.push(getLogContext()?.requestId ?? "");
      });
    await Promise.all([run("r1", 10), run("r2", 1), run("r3", 5)]);
    assert.deepStrictEqual(results.sort(), ["r1", "r2", "r3"]);
  });

  test("returns undefined outside a context", () => {
    assert.strictEqual(getLogContext(), undefined);
  });

  test("nested context inherits outer requestId (router → provider)", async () => {
    const routerCtx = { requestId: "outer-req", modelId: "m" };
    let observed: ReturnType<typeof getLogContext>;
    await withLogContext(routerCtx, async () => {
      const existing = getLogContext();
      await withLogContext(
        { ...existing, providerId: "deepseek" },
        async () => {
          observed = getLogContext();
        },
      );
    });
    assert.strictEqual(observed!.requestId, "outer-req");
    assert.strictEqual(observed!.providerId, "deepseek");
  });

  test("generateRequestId returns 6-char unique ids", () => {
    const ids = new Set<string>();
    for (let i = 0; i < 1000; i++) {
      ids.add(generateRequestId());
    }
    assert.strictEqual(ids.size, 1000);
    for (const id of ids) {
      assert.match(id, /^[0-9a-f]{6}$/);
    }
  });
});
