import * as assert from "assert";
import {
  TokenPlan,
  type TokenConsumption,
  type TokenPlanConfig,
} from "../core/token-plan";
import { builtInPresets } from "../plans";

function createMockContext(): Record<string, unknown> {
  const state = new Map<string, unknown>();
  const secrets = new Map<string, string>();
  return {
    globalState: {
      get: (key: string, defaultValue?: unknown) =>
        state.has(key) ? state.get(key) : defaultValue,
      update: async (key: string, value: unknown) => {
        state.set(key, value);
      },
    },
    secrets: {
      store: async (key: string, value: string) => {
        secrets.set(key, value);
      },
      get: async (key: string) => secrets.get(key),
      delete: async (key: string) => {
        secrets.delete(key);
      },
    },
  };
}

suite("TokenPlan Test Suite", () => {
  let plan: TokenPlan;
  let ctx: Record<string, unknown>;

  setup(() => {
    ctx = createMockContext();
    plan = TokenPlan.init(ctx as any, builtInPresets);
  });

  teardown(() => {
    TokenPlan.resetInstance();
  });

  // ── 服务商预设 ───────────────────────────────────

  suite("Presets", () => {
    test("has 1 built-in preset", () => {
      assert.strictEqual(plan.getPresets().length, 1);
    });

    test("presets have required fields", () => {
      for (const preset of plan.getPresets()) {
        assert.ok(preset.id);
        assert.ok(preset.defaultBaseUrl);
        assert.ok(preset.models.length > 0);
      }
    });

    test("Qwen preset has correct models", () => {
      const qw = plan.getPresets().find((p) => p.id === "qwen")!;
      assert.ok(qw.models.length >= 4);
      assert.ok(qw.models.some((m) => m.id.includes("qwen")));
    });
  });

  // ── URL 解析 ─────────────────────────────────────

  suite("extractHostname", () => {
    test("extracts hostname from full URL", () => {
      assert.strictEqual(
        plan.extractHostname("https://api.deepseek.com/v1/chat"),
        "api.deepseek.com",
      );
    });

    test("extracts hostname without port", () => {
      assert.strictEqual(
        plan.extractHostname("https://dashscope.aliyuncs.com:443"),
        "dashscope.aliyuncs.com",
      );
    });

    test("returns input for invalid URL", () => {
      assert.strictEqual(plan.extractHostname("not-a-url"), "not-a-url");
    });

    test("handles empty string", () => {
      assert.strictEqual(plan.extractHostname(""), "");
    });
  });

  suite("detectProviderFromUrl", () => {
    test("detects Qwen by defaultBaseUrl hostname", () => {
      const preset = plan.detectProviderFromUrl(
        "https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1/chat",
      );
      assert.ok(preset);
      assert.strictEqual(preset!.id, "qwen");
    });

    test("detects Qwen by subdomain of defaultBaseUrl", () => {
      const preset = plan.detectProviderFromUrl(
        "https://sub.token-plan.cn-beijing.maas.aliyuncs.com/v1",
      );
      assert.ok(preset);
      assert.strictEqual(preset!.id, "qwen");
    });

    test("returns undefined for unknown URL", () => {
      assert.strictEqual(
        plan.detectProviderFromUrl("https://unknown.example.com"),
        undefined,
      );
    });

    test("rejects spoofed hostname", () => {
      assert.strictEqual(
        plan.detectProviderFromUrl(
          "https://evil-token-plan.cn-beijing.maas.aliyuncs.com.attacker.com",
        ),
        undefined,
      );
    });

    test("does not detect unrelated hostname (e.g. dashscope)", () => {
      assert.strictEqual(
        plan.detectProviderFromUrl("https://dashscope.aliyuncs.com/v1"),
        undefined,
      );
    });
  });

  // ── generatePlanId ───────────────────────────────

  suite("generatePlanId", () => {
    test("includes the endpoint host and path", () => {
      assert.strictEqual(
        plan.generatePlanId("https://api.deepseek.com/v1"),
        "plan-api-deepseek-com-v1",
      );
    });

    test("is stable for the same endpoint", () => {
      // Stability is the contract, not an incidental property. It is what makes
      // re-configuring an endpoint replace its plan: with a timestamp in the id
      // every configuration created a second plan, and the model lookup took
      // the first one, so a replaced token never took effect.
      assert.strictEqual(
        plan.generatePlanId("https://example.com/v1"),
        plan.generatePlanId("https://example.com/v1"),
      );
    });

    test("treats a trailing slash and case as the same endpoint", () => {
      assert.strictEqual(
        plan.generatePlanId("https://Example.com/v1"),
        plan.generatePlanId("https://example.com/v1/"),
      );
    });

    test("keeps two endpoints on one host distinct", () => {
      assert.notStrictEqual(
        plan.generatePlanId("https://example.com/v1"),
        plan.generatePlanId("https://example.com/v2"),
      );
    });

    test("falls back for invalid URL", () => {
      const id = plan.generatePlanId("");
      assert.ok(id.startsWith("plan-"));
    });
  });

  // ── storePlanForEndpoint ─────────────────────——

  suite("storePlanForEndpoint", () => {
    const ENDPOINT = "https://token-plan.example.com/v1";

    function config(
      planId: string,
      planName: string,
      baseUrl = ENDPOINT,
    ): TokenPlanConfig {
      return {
        planId,
        planName,
        baseUrl,
        providerId: "qwen",
        models: [{ id: "qwen3.8-max" }],
        createdAt: 1,
        updatedAt: 1,
      };
    }

    test("replaces the plan already configured for the endpoint", async () => {
      // Re-running the wizard against the same URL is how a user swaps in a
      // new token. It must not leave the previous plan in place.
      const firstId = plan.generatePlanId(ENDPOINT);
      await plan.storePlanForEndpoint(config(firstId, "First"), "old-token");

      await plan.storePlanForEndpoint(config(firstId, "Second"), "new-token");

      const plans = plan.getPlans();
      assert.strictEqual(plans.length, 1);
      assert.strictEqual(plans[0].planName, "Second");
      assert.strictEqual(await plan.getToken(firstId), "new-token");
    });

    test("drops the superseded plan and its stored token", async () => {
      // Plans written by earlier versions carry a timestamp-based id, so
      // matching on planId alone would leave them behind.
      const legacyId = "plan-token-plan-example-com-1700000000000";
      await plan.storePlan(config(legacyId, "Legacy"));
      await plan.storeToken(legacyId, "stale-token");

      const newId = plan.generatePlanId(ENDPOINT);
      await plan.storePlanForEndpoint(config(newId, "New"), "new-token");

      assert.deepStrictEqual(
        plan.getPlans().map((p) => p.planId),
        [newId],
      );
      assert.strictEqual(
        await plan.getToken(legacyId),
        undefined,
        "the superseded token must not be left in SecretStorage",
      );
    });

    test("keeps plans for other endpoints", async () => {
      const otherEndpoint = "https://other.example.com/v1";
      await plan.storePlanForEndpoint(
        config(plan.generatePlanId(otherEndpoint), "Other", otherEndpoint),
        "other-token",
      );
      await plan.storePlanForEndpoint(
        config(plan.generatePlanId(ENDPOINT), "Mine"),
        "my-token",
      );

      assert.strictEqual(plan.getPlans().length, 2);
    });
  });

  // ── resolvePlanOverride precedence ───────────────

  suite("resolvePlanOverride precedence", () => {
    test("prefers the most recently updated plan covering the model", async () => {
      // Two endpoints can list the same model. Taking the first match meant an
      // older plan shadowed a newer one regardless of when it was configured.
      await plan.storePlan({
        planId: "older",
        planName: "Older",
        baseUrl: "https://old.example.com/v1",
        providerId: "qwen",
        models: [{ id: "shared-model" }],
        createdAt: 1,
        updatedAt: 100,
      });
      await plan.storeToken("older", "old-token");
      await plan.storePlan({
        planId: "newer",
        planName: "Newer",
        baseUrl: "https://new.example.com/v1",
        providerId: "qwen",
        models: [{ id: "shared-model" }],
        createdAt: 2,
        updatedAt: 200,
      });
      await plan.storeToken("newer", "new-token");

      const chosen = await plan.resolvePlanOverride("shared-model");
      assert.strictEqual(chosen?.planId, "newer");
      assert.strictEqual(chosen?.apiKey, "new-token");
    });
  });

  // ── Plan CRUD ────────────────────────────────────

  suite("Plan CRUD", () => {
    test("getPlans returns empty array initially", () => {
      assert.deepStrictEqual(plan.getPlans(), []);
    });

    test("storePlan adds new plan", async () => {
      await plan.storePlan({
        planId: "plan-1",
        planName: "P1",
        baseUrl: "https://a.com",
        providerId: "a",
        models: [],
        createdAt: 1,
        updatedAt: 1,
      });
      assert.strictEqual(plan.getPlans().length, 1);
      assert.strictEqual(plan.getPlans()[0].planId, "plan-1");
    });

    test("storePlan updates existing plan", async () => {
      await plan.storePlan({
        planId: "plan-1",
        planName: "P1",
        baseUrl: "https://a.com",
        providerId: "a",
        models: [],
        createdAt: 1,
        updatedAt: 1,
      });
      await plan.storePlan({
        planId: "plan-1",
        planName: "Updated",
        baseUrl: "https://a.com",
        providerId: "a",
        models: [],
        createdAt: 1,
        updatedAt: 2,
      });
      assert.strictEqual(plan.getPlans().length, 1);
      assert.strictEqual(plan.getPlans()[0].planName, "Updated");
    });

    test("removePlan removes by ID", async () => {
      await plan.storePlan({
        planId: "keep",
        planName: "K",
        baseUrl: "https://a.com",
        providerId: "a",
        models: [],
        createdAt: 1,
        updatedAt: 1,
      });
      await plan.storePlan({
        planId: "remove",
        planName: "R",
        baseUrl: "https://b.com",
        providerId: "b",
        models: [],
        createdAt: 2,
        updatedAt: 2,
      });
      await plan.removePlan("remove");
      assert.strictEqual(plan.getPlans().length, 1);
      assert.strictEqual(plan.getPlans()[0].planId, "keep");
    });

    test("getPlanModelIds returns all covered model IDs", async () => {
      await plan.storePlan({
        planId: "p1",
        planName: "P1",
        baseUrl: "https://a.com",
        models: [{ id: "m1" }, { id: "m2" }],
        createdAt: 1,
        updatedAt: 1,
      });
      const ids = plan.getPlanModelIds();
      assert.ok(ids.has("m1"));
      assert.ok(ids.has("m2"));
      assert.strictEqual(ids.size, 2);
    });
  });

  // ── Token 管理 ───────────────────────────────────

  suite("Token Management", () => {
    test("storeToken and getToken roundtrip", async () => {
      await plan.storeToken("plan-1", "sk-token-abc");
      const token = await plan.getToken("plan-1");
      assert.strictEqual(token, "sk-token-abc");
    });

    test("getToken returns undefined for non-existent", async () => {
      assert.strictEqual(await plan.getToken("non-existent"), undefined);
    });

    test("removeToken removes stored token", async () => {
      await plan.storeToken("plan-1", "sk-token");
      await plan.removeToken("plan-1");
      assert.strictEqual(await plan.getToken("plan-1"), undefined);
    });

    test("removeToken does not throw for non-existent", async () => {
      await plan.removeToken("non-existent");
    });
  });

  // ── 消费记录 ─────────────────────────────────────

  suite("Consumption", () => {
    test("getConsumptions returns empty array initially", () => {
      assert.strictEqual(plan.getConsumptions().length, 0);
    });

    test("recordConsumption adds record", async () => {
      await plan.recordConsumption({
        planId: "p1",
        modelId: "m1",
        promptTokens: 100,
        completionTokens: 50,
        totalTokens: 150,
        timestamp: 1000,
      });
      const records = plan.getConsumptions();
      assert.strictEqual(records.length, 1);
      assert.strictEqual(records[0].totalTokens, 150);
    });

    test("recordConsumption appends", async () => {
      await plan.recordConsumption({
        planId: "p1",
        modelId: "m1",
        promptTokens: 10,
        completionTokens: 5,
        totalTokens: 15,
        timestamp: 1,
      });
      await plan.recordConsumption({
        planId: "p1",
        modelId: "m2",
        promptTokens: 20,
        completionTokens: 10,
        totalTokens: 30,
        timestamp: 2,
      });
      assert.strictEqual(plan.getConsumptions().length, 2);
    });

    test("concurrent recordConsumption calls do not lose records", async () => {
      // Model a globalState whose writes take a turn of the event loop, which
      // is what real disk-backed storage does. A read-modify-write without
      // serialization loses every record but the last writer's.
      const state = new Map<string, unknown>();
      const slowCtx = {
        globalState: {
          get: (key: string, defaultValue?: unknown) =>
            state.has(key) ? state.get(key) : defaultValue,
          update: async (key: string, value: unknown) => {
            await new Promise((resolve) => setTimeout(resolve, 0));
            state.set(key, value);
          },
        },
        secrets: {
          store: async () => {},
          get: async () => undefined,
          delete: async () => {},
        },
      };
      const concurrentPlan = TokenPlan.init(slowCtx as never, builtInPresets);

      const COUNT = 10;
      await Promise.all(
        Array.from({ length: COUNT }, (_, i) =>
          concurrentPlan.recordConsumption({
            planId: "p1",
            modelId: `m${i}`,
            promptTokens: 1,
            completionTokens: 1,
            totalTokens: 2,
            timestamp: i,
          }),
        ),
      );

      assert.strictEqual(
        concurrentPlan.getConsumptions().length,
        COUNT,
        "every concurrent record must survive",
      );
    });
  });

  // ── 写入合并 ─────────────────────────────────────

  suite("Consumption write coalescing", () => {
    /**
     * A context whose writes are counted and take a turn of the event loop,
     * like the real disk-backed storage does.
     */
    function createCountingContext(): {
      context: Record<string, unknown>;
      updates: () => number;
      persisted: () => TokenConsumption[] | undefined;
    } {
      const state = new Map<string, unknown>();
      let updates = 0;
      const context = {
        globalState: {
          get: (key: string, defaultValue?: unknown) =>
            state.has(key) ? state.get(key) : defaultValue,
          update: async (key: string, value: unknown) => {
            updates++;
            await new Promise((resolve) => setTimeout(resolve, 0));
            state.set(key, value);
          },
        },
        secrets: {
          store: async () => {},
          get: async () => undefined,
          delete: async () => {},
        },
      };

      return {
        context,
        updates: () => updates,
        // The key is private to TokenPlan, so pick the stored array instead of
        // duplicating the literal here.
        persisted: () =>
          [...state.values()].find((v) => Array.isArray(v)) as
            | TokenConsumption[]
            | undefined,
      };
    }

    function consumption(index: number): TokenConsumption {
      return {
        planId: "p1",
        modelId: `m${index}`,
        promptTokens: 1,
        completionTokens: 1,
        totalTokens: 2,
        timestamp: index,
      };
    }

    test("coalesces a burst into a single write without losing records", async () => {
      const { context, updates, persisted } = createCountingContext();
      const burstPlan = TokenPlan.init(context as never, builtInPresets);

      const COUNT = 10;
      await Promise.all(
        Array.from({ length: COUNT }, (_, i) =>
          burstPlan.recordConsumption(consumption(i)),
        ),
      );

      // Records queued while a write is pending add nothing to it: the pending
      // write snapshots the live log when it runs. One write per record made a
      // burst of N cost N writes of a growing array.
      assert.strictEqual(
        updates(),
        1,
        `expected one coalesced write, got ${updates()}`,
      );
      assert.strictEqual(
        persisted()?.length,
        COUNT,
        "the coalesced write must still contain every record",
      );
    });

    test("a record written on its own is still persisted immediately", async () => {
      const { context, updates, persisted } = createCountingContext();
      const singlePlan = TokenPlan.init(context as never, builtInPresets);

      await singlePlan.recordConsumption(consumption(1));

      assert.strictEqual(updates(), 1);
      assert.strictEqual(persisted()?.length, 1);
    });

    test("clearing while a write is queued still persists the empty log", async () => {
      const { context, persisted } = createCountingContext();
      const burstPlan = TokenPlan.init(context as never, builtInPresets);

      // Not awaited: the clear must be safe while the record's write is still
      // queued, otherwise a stale snapshot could resurrect the records.
      const recording = burstPlan.recordConsumption(consumption(1));
      const clearing = burstPlan.clearConsumptions();
      await Promise.all([recording, clearing]);

      assert.deepStrictEqual(persisted(), []);
      assert.strictEqual(burstPlan.getConsumptions().length, 0);
    });

    test("keeps persisting after a failed write", async () => {
      let failNext = true;
      let stored: unknown;
      const context = {
        globalState: {
          get: () => [],
          update: async (_key: string, value: unknown) => {
            if (failNext) {
              failNext = false;
              throw new Error("disk full");
            }
            stored = value;
          },
        },
        secrets: {
          store: async () => {},
          get: async () => undefined,
          delete: async () => {},
        },
      };
      const flakyPlan = TokenPlan.init(context as never, builtInPresets);

      await assert.rejects(
        () => flakyPlan.recordConsumption(consumption(1)),
        /disk full/,
      );
      await flakyPlan.recordConsumption(consumption(2));

      assert.strictEqual(
        (stored as TokenConsumption[] | undefined)?.length,
        2,
        "a failed write must not break the chain",
      );
    });
  });

  // ── 使用量事件与清空 ──────────────────────────

  suite("Usage events and reset", () => {
    test("records direct API-key usage without a plan id", async () => {
      await plan.recordConsumption({
        providerId: "deepseek",
        modelId: "deepseek-flash",
        promptTokens: 1,
        completionTokens: 2,
        totalTokens: 3,
        timestamp: 5,
      });

      const records = plan.getConsumptions();
      assert.strictEqual(records.length, 1);
      assert.strictEqual(
        records[0].planId,
        undefined,
        "direct requests carry no plan id",
      );
      assert.strictEqual(records[0].providerId, "deepseek");
    });

    test("emits onDidChangeUsage once the record is persisted", async () => {
      let changes = 0;
      const subscription = plan.onDidChangeUsage(() => {
        changes++;
      });

      try {
        await plan.recordConsumption({
          planId: "p1",
          modelId: "m1",
          promptTokens: 1,
          completionTokens: 2,
          totalTokens: 3,
          timestamp: 5,
        });
      } finally {
        subscription.dispose();
      }

      assert.strictEqual(changes, 1);
    });

    test("emits onDidChangeUsage when the log is cleared", async () => {
      // Without this the status bar keeps showing the pre-clear figures.
      let changes = 0;
      const subscription = plan.onDidChangeUsage(() => {
        changes++;
      });

      try {
        await plan.recordConsumption({
          planId: "p1",
          modelId: "m1",
          promptTokens: 1,
          completionTokens: 1,
          totalTokens: 2,
          timestamp: 1,
        });
        await plan.clearConsumptions();
      } finally {
        subscription.dispose();
      }

      assert.strictEqual(changes, 2, "one for the record, one for the clear");
    });

    test("clearConsumptions drops every record", async () => {
      await plan.recordConsumption({
        planId: "p1",
        modelId: "m1",
        promptTokens: 1,
        completionTokens: 1,
        totalTokens: 2,
        timestamp: 1,
      });
      await plan.recordConsumption({
        planId: "p2",
        modelId: "m2",
        promptTokens: 3,
        completionTokens: 4,
        totalTokens: 7,
        timestamp: 2,
      });
      assert.strictEqual(plan.getConsumptions().length, 2);

      await plan.clearConsumptions();

      assert.strictEqual(plan.getConsumptions().length, 0);
    });

    test("accepts new records after clearing", async () => {
      await plan.recordConsumption({
        planId: "p1",
        modelId: "m1",
        promptTokens: 1,
        completionTokens: 1,
        totalTokens: 2,
        timestamp: 1,
      });
      await plan.clearConsumptions();

      await plan.recordConsumption({
        planId: "p1",
        modelId: "m2",
        promptTokens: 5,
        completionTokens: 5,
        totalTokens: 10,
        timestamp: 2,
      });

      const records = plan.getConsumptions();
      assert.strictEqual(records.length, 1);
      assert.strictEqual(records[0].totalTokens, 10);
    });
  });

  // ── resolvePlanOverride ──────────────────────────

  suite("resolvePlanOverride", () => {
    test("returns undefined when no plans exist", async () => {
      assert.strictEqual(await plan.resolvePlanOverride("m1"), undefined);
    });

    test("returns undefined when model not covered", async () => {
      await plan.storePlan({
        planId: "p1",
        planName: "P1",
        baseUrl: "https://a.com",
        models: [{ id: "m1" }],
        createdAt: 1,
        updatedAt: 1,
      });
      assert.strictEqual(await plan.resolvePlanOverride("m999"), undefined);
    });

    test("returns undefined when token missing", async () => {
      await plan.storePlan({
        planId: "p1",
        planName: "P1",
        baseUrl: "https://a.com",
        models: [{ id: "m1" }],
        createdAt: 1,
        updatedAt: 1,
      });
      assert.strictEqual(await plan.resolvePlanOverride("m1"), undefined);
    });

    test("returns PlanOverride with consumptionRate 1", async () => {
      await plan.storePlan({
        planId: "p1",
        planName: "P1",
        baseUrl: "https://a.com",
        models: [{ id: "m1" }],
        createdAt: 1,
        updatedAt: 1,
      });
      await plan.storeToken("p1", "sk-test");
      const override = await plan.resolvePlanOverride("m1");
      assert.ok(override);
      assert.strictEqual(override!.planId, "p1");
      assert.strictEqual(override!.baseUrl, "https://a.com");
      assert.strictEqual(override!.apiKey, "sk-test");
      assert.strictEqual(override!.consumptionRate, 1);
    });
  });
});
