import * as assert from "assert";
import {
  TokenPlan,
  type TokenPlanConfig,
  type TokenPlanModel,
  type TokenPlanConsumption,
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
    test("generates id with hostname prefix", () => {
      const id = plan.generatePlanId("https://api.deepseek.com");
      assert.ok(id.startsWith("plan-api-deepseek-com-"));
    });

    test("generates unique ids", async () => {
      const id1 = plan.generatePlanId("https://example.com");
      await new Promise((r) => setTimeout(r, 5));
      const id2 = plan.generatePlanId("https://example.com");
      assert.notStrictEqual(id1, id2);
    });

    test("falls back for invalid URL", () => {
      const id = plan.generatePlanId("");
      assert.ok(id.startsWith("plan-"));
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
