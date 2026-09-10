/**
 * Tests for provider balance lookup.
 *
 * Only DeepSeek has a documented balance API, so parsing and formatting are
 * asserted against that shape. Lookups must never throw: every failure path
 * degrades to a reason the report renders as "unavailable".
 */

import * as assert from "assert";
import {
  balanceProviderIds,
  collectProviderBalances,
  fetchProviderBalance,
  formatBalanceAmount,
  formatBalanceSection,
  parseDeepSeekBalance,
  supportsBalance,
  type ProviderBalanceResult,
} from "../core/balance";
import type { IModelProvider } from "../core/model-provider";
import { ProviderModels } from "../core/provider-models";

const PROVIDER = "deepseek";
const FETCHED_AT = 1_700_000_000_000;

/** Provider stub: only the parts the balance lookup touches. */
function createProvider(
  overrides: {
    id?: string;
    apiKey?: string | undefined;
    baseUrl?: string;
  } = {},
): IModelProvider {
  return {
    id: overrides.id ?? PROVIDER,
    config: {
      vendorId: overrides.id ?? PROVIDER,
      vendorName: "Test",
      baseUrl: overrides.baseUrl ?? "https://api.deepseek.com",
      apiKeySecretKey: "copilot-models.test.apiKey",
    },
    getApiKey: async () => overrides.apiKey,
    hasApiKey: async () => overrides.apiKey !== undefined,
    promptForApiKey: async () => false,
    deleteApiKey: async () => {},
    getModels: () => [],
    createClient: () => ({}) as never,
  };
}

/**
 * Swap global fetch for the duration of `run`, then restore it.
 * Returns the URL and Authorization header seen by the stub.
 */
async function withFetch(
  stub: (url: string, init?: RequestInit) => Promise<Response>,
  run: () => Promise<void>,
): Promise<{ url: string; authorization: string | undefined }> {
  const original = globalThis.fetch;
  let seenUrl = "";
  let seenAuth: string | undefined;

  globalThis.fetch = ((url: string, init?: RequestInit) => {
    seenUrl = String(url);
    seenAuth = (init?.headers as Record<string, string> | undefined)
      ?.Authorization;
    return stub(String(url), init);
  }) as typeof fetch;

  try {
    await run();
  } finally {
    globalThis.fetch = original;
  }

  assert.ok(seenUrl !== "", "fetch stub was never called");
  return { url: seenUrl, authorization: seenAuth };
}

function jsonResponse(payload: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload,
  } as Response;
}

const DEEPSEEK_PAYLOAD = {
  is_available: true,
  balance_infos: [
    {
      currency: "CNY",
      total_balance: "110.00",
      granted_balance: "10.00",
      topped_up_balance: "100.00",
    },
  ],
};

suite("balance capability Test Suite", () => {
  test("only providers with a documented balance API are supported", () => {
    assert.strictEqual(supportsBalance("deepseek"), true);
    assert.strictEqual(supportsBalance("bigmodel"), false);
    assert.strictEqual(supportsBalance("qwen"), false);
    assert.deepStrictEqual(balanceProviderIds(), ["deepseek"]);
  });
});

suite("parseDeepSeekBalance Test Suite", () => {
  test("parses the documented response", () => {
    const balance = parseDeepSeekBalance(
      DEEPSEEK_PAYLOAD,
      PROVIDER,
      FETCHED_AT,
    );

    assert.ok(balance);
    assert.strictEqual(balance.providerId, PROVIDER);
    assert.strictEqual(balance.isAvailable, true);
    assert.strictEqual(balance.entries.length, 1);
    assert.deepStrictEqual(balance.entries[0], {
      currency: "CNY",
      totalBalance: "110.00",
      grantedBalance: "10.00",
      toppedUpBalance: "100.00",
    });
  });

  test("keeps amounts as strings so currency never rounds", () => {
    const balance = parseDeepSeekBalance(
      { balance_infos: [{ currency: "CNY", total_balance: "0.10" }] },
      PROVIDER,
      FETCHED_AT,
    );
    assert.strictEqual(balance?.entries[0].totalBalance, "0.10");
  });

  test("accepts numeric amounts and a missing breakdown", () => {
    const balance = parseDeepSeekBalance(
      { balance_infos: [{ currency: "USD", total_balance: 12.5 }] },
      PROVIDER,
      FETCHED_AT,
    );

    assert.strictEqual(balance?.entries[0].totalBalance, "12.5");
    assert.strictEqual(balance?.entries[0].grantedBalance, undefined);
    assert.strictEqual(balance?.entries[0].toppedUpBalance, undefined);
  });

  test("reports an unusable balance", () => {
    const balance = parseDeepSeekBalance(
      { ...DEEPSEEK_PAYLOAD, is_available: false },
      PROVIDER,
      FETCHED_AT,
    );
    assert.strictEqual(balance?.isAvailable, false);
  });

  test("assumes usable when the flag is absent", () => {
    const balance = parseDeepSeekBalance(
      { balance_infos: [{ currency: "CNY", total_balance: "1" }] },
      PROVIDER,
      FETCHED_AT,
    );
    assert.strictEqual(balance?.isAvailable, true);
  });

  test("returns undefined for unusable shapes instead of guessing", () => {
    assert.strictEqual(
      parseDeepSeekBalance(null, PROVIDER, FETCHED_AT),
      undefined,
    );
    assert.strictEqual(
      parseDeepSeekBalance("nope", PROVIDER, FETCHED_AT),
      undefined,
    );
    assert.strictEqual(
      parseDeepSeekBalance({}, PROVIDER, FETCHED_AT),
      undefined,
      "missing balance_infos",
    );
    assert.strictEqual(
      parseDeepSeekBalance({ balance_infos: [] }, PROVIDER, FETCHED_AT),
      undefined,
      "empty balance_infos",
    );
    assert.strictEqual(
      parseDeepSeekBalance(
        { balance_infos: [{ currency: "CNY" }] },
        PROVIDER,
        FETCHED_AT,
      ),
      undefined,
      "entry without a total",
    );
  });
});

suite("fetchProviderBalance Test Suite", () => {
  test("skips providers without a balance API", async () => {
    const result = await fetchProviderBalance(createProvider({ id: "qwen" }));

    assert.strictEqual(result.providerId, "qwen");
    assert.strictEqual(result.reason, "not-supported");
    assert.strictEqual(result.balance, undefined);
  });

  test("reports a missing API key without calling the network", async () => {
    const original = globalThis.fetch;
    let called = false;
    globalThis.fetch = (async () => {
      called = true;
      return jsonResponse({});
    }) as typeof fetch;

    try {
      const result = await fetchProviderBalance(
        createProvider({ apiKey: undefined }),
      );

      assert.strictEqual(result.reason, "not-configured");
      assert.strictEqual(called, false, "no request without a key");
    } finally {
      globalThis.fetch = original;
    }
  });

  test("queries /user/balance with a bearer token and parses the result", async () => {
    const provider = createProvider({ apiKey: "sk-test" });

    const seen = await withFetch(
      async () => jsonResponse(DEEPSEEK_PAYLOAD),
      async () => {
        const result = await fetchProviderBalance(provider);

        assert.strictEqual(result.balance?.entries[0].totalBalance, "110.00");
        assert.strictEqual(result.reason, undefined);
      },
    );

    assert.strictEqual(seen.url, "https://api.deepseek.com/user/balance");
    assert.strictEqual(seen.authorization, "Bearer sk-test");
  });

  test("normalizes a base URL that carries a trailing slash", async () => {
    const provider = createProvider({
      apiKey: "sk-test",
      baseUrl: "https://api.deepseek.com/",
    });

    const seen = await withFetch(
      async () => jsonResponse(DEEPSEEK_PAYLOAD),
      async () => {
        await fetchProviderBalance(provider);
      },
    );

    assert.strictEqual(
      seen.url,
      "https://api.deepseek.com/user/balance",
      "a trailing slash must not produce a double slash",
    );
  });

  test("degrades to request-failed on an HTTP error instead of throwing", async () => {
    const provider = createProvider({ apiKey: "sk-test" });

    await withFetch(
      async () => jsonResponse({ error: "unauthorized" }, 401),
      async () => {
        const result = await fetchProviderBalance(provider);

        assert.strictEqual(result.reason, "request-failed");
        assert.strictEqual(result.balance, undefined);
      },
    );
  });

  test("degrades to request-failed when the network rejects", async () => {
    const provider = createProvider({ apiKey: "sk-test" });

    await withFetch(
      async () => {
        throw new Error("ECONNREFUSED");
      },
      async () => {
        const result = await fetchProviderBalance(provider);

        assert.strictEqual(result.reason, "request-failed");
      },
    );
  });

  test("degrades to request-failed on an unexpected response shape", async () => {
    const provider = createProvider({ apiKey: "sk-test" });

    await withFetch(
      async () => jsonResponse({ unexpected: true }),
      async () => {
        const result = await fetchProviderBalance(provider);

        assert.strictEqual(result.reason, "request-failed");
      },
    );
  });
});

suite("formatBalanceAmount Test Suite", () => {
  test("maps known currencies to symbols", () => {
    assert.strictEqual(formatBalanceAmount("110.00", "CNY"), "¥110.00");
    assert.strictEqual(formatBalanceAmount("12.50", "USD"), "$12.50");
    assert.strictEqual(formatBalanceAmount("5.00", "cny"), "¥5.00");
  });

  test("falls back to the currency code", () => {
    assert.strictEqual(formatBalanceAmount("7.00", "SGD"), "7.00 SGD");
  });

  test("omits an unknown, empty currency", () => {
    assert.strictEqual(formatBalanceAmount("7.00", ""), "7.00");
  });
});

suite("formatBalanceSection Test Suite", () => {
  test("returns nothing for an empty result list", () => {
    assert.deepStrictEqual(formatBalanceSection([]), []);
  });

  test("renders a balance with its breakdown", () => {
    const results: ProviderBalanceResult[] = [
      {
        providerId: PROVIDER,
        balance: {
          providerId: PROVIDER,
          isAvailable: true,
          entries: [
            {
              currency: "CNY",
              totalBalance: "110.00",
              grantedBalance: "10.00",
              toppedUpBalance: "100.00",
            },
          ],
          fetchedAt: FETCHED_AT,
        },
      },
    ];

    const lines = formatBalanceSection(results);
    assert.strictEqual(lines[0], "Balance:");
    assert.strictEqual(
      lines[1],
      "  deepseek: ¥110.00 (granted ¥10.00 · topped up ¥100.00)",
    );
  });

  test("warns when the balance cannot cover calls", () => {
    const lines = formatBalanceSection([
      {
        providerId: PROVIDER,
        balance: {
          providerId: PROVIDER,
          isAvailable: false,
          entries: [{ currency: "CNY", totalBalance: "0.00" }],
          fetchedAt: FETCHED_AT,
        },
      },
    ]);

    assert.ok(lines[1].includes("insufficient for API calls"));
  });

  test("omits a provider that has no API key configured", () => {
    // The user is not using this provider, so a "no API key" line is noise.
    const lines = formatBalanceSection([
      { providerId: "deepseek", reason: "not-configured" },
    ]);

    assert.deepStrictEqual(lines, []);
  });

  test("omits a provider without a balance API", () => {
    const lines = formatBalanceSection([
      { providerId: "qwen", reason: "not-supported" },
    ]);

    assert.deepStrictEqual(lines, []);
  });

  test("hides the whole section when nothing is reportable", () => {
    const lines = formatBalanceSection([
      { providerId: "deepseek", reason: "not-configured" },
      { providerId: "qwen", reason: "not-supported" },
    ]);

    assert.deepStrictEqual(
      lines,
      [],
      "the Balance: header must not appear on its own",
    );
  });

  test("reports a configured provider whose lookup failed", () => {
    const lines = formatBalanceSection([
      { providerId: "deepseek", reason: "request-failed" },
    ]);

    assert.strictEqual(lines[0], "Balance:");
    assert.ok(lines[1].includes("deepseek: unavailable"));
  });

  test("mixes a real balance with a failed lookup and skips the rest", () => {
    const lines = formatBalanceSection([
      { providerId: "skipped", reason: "not-configured" },
      { providerId: "broken", reason: "request-failed" },
      {
        providerId: PROVIDER,
        balance: {
          providerId: PROVIDER,
          isAvailable: true,
          entries: [{ currency: "CNY", totalBalance: "5.00" }],
          fetchedAt: FETCHED_AT,
        },
      },
    ]);

    assert.strictEqual(lines[0], "Balance:");
    assert.strictEqual(lines.length, 3, "only the two reportable ones");
    assert.ok(lines[1].includes("broken: unavailable"));
    assert.ok(lines[2].includes("deepseek: ¥5.00"));
  });

  test("never exposes a raw error or key in the output", () => {
    const lines = formatBalanceSection([
      { providerId: "deepseek", reason: "request-failed" },
    ]).join("\n");

    assert.ok(!lines.includes("Bearer"));
    assert.ok(!lines.includes("sk-"));
  });
});

suite("fetchProviderBalance abort handling Test Suite", () => {
  const originalFetch = globalThis.fetch;

  teardown(() => {
    globalThis.fetch = originalFetch;
  });

  test("forwards an already-aborted signal to the request", async () => {
    // The previous implementation attached an "abort" listener to the caller's
    // signal. A signal that was already aborted never fires that event, so the
    // request went out anyway — the exact case of a caller that gave up before
    // the lookup started.
    const controller = new AbortController();
    controller.abort();

    let sawAborted: boolean | undefined;
    await withFetch(
      async (_url, init) => {
        sawAborted = init?.signal?.aborted;
        return jsonResponse(DEEPSEEK_PAYLOAD);
      },
      async () => {
        await fetchProviderBalance(
          createProvider({ apiKey: "sk-test" }),
          controller.signal,
        );
      },
    );

    assert.strictEqual(
      sawAborted,
      true,
      "an already-aborted signal must reach fetch",
    );
  });

  test("passes a live signal that is not yet aborted", async () => {
    const controller = new AbortController();

    let sawAborted: boolean | undefined;
    await withFetch(
      async (_url, init) => {
        sawAborted = init?.signal?.aborted;
        return jsonResponse(DEEPSEEK_PAYLOAD);
      },
      async () => {
        await fetchProviderBalance(
          createProvider({ apiKey: "sk-test" }),
          controller.signal,
        );
      },
    );

    assert.strictEqual(sawAborted, false);
  });

  test("still bounds the request when no caller signal is given", async () => {
    // The timeout must survive the removal of the hand-rolled timer.
    let sawSignal = false;
    await withFetch(
      async (_url, init) => {
        sawSignal = init?.signal !== undefined && init.signal !== null;
        return jsonResponse(DEEPSEEK_PAYLOAD);
      },
      async () => {
        await fetchProviderBalance(createProvider({ apiKey: "sk-test" }));
      },
    );

    assert.strictEqual(sawSignal, true, "the lookup must stay time-bounded");
  });
});

suite("collectProviderBalances Test Suite", () => {
  const originalFetch = globalThis.fetch;

  teardown(() => {
    globalThis.fetch = originalFetch;
    if (ProviderModels.isInitialized()) {
      ProviderModels.resetInstance();
    }
  });

  test("returns nothing when the provider registry is not initialized", async () => {
    ProviderModels.resetInstance();
    assert.deepStrictEqual(await collectProviderBalances(), []);
  });

  test("queries each supported provider and keeps a stable order", async () => {
    ProviderModels.init([]);
    ProviderModels.getInstance().registerProvider(
      createProvider({ id: "deepseek", apiKey: "sk-test" }),
    );

    const seenUrls: string[] = [];
    globalThis.fetch = (async (url: string) => {
      seenUrls.push(String(url));
      return jsonResponse(DEEPSEEK_PAYLOAD);
    }) as unknown as typeof fetch;

    const results = await collectProviderBalances();

    assert.deepStrictEqual(seenUrls, ["https://api.deepseek.com/user/balance"]);
    assert.deepStrictEqual(
      results.map((r) => r.providerId),
      balanceProviderIds(),
      "the results must line up with the documented provider order",
    );
    assert.ok(results[0].balance, "the balance must be parsed");
  });

  test("skips providers without a balance API rather than reporting them", async () => {
    ProviderModels.init([]);
    const registry = ProviderModels.getInstance();
    registry.registerProvider(
      createProvider({ id: "deepseek", apiKey: "sk-test" }),
    );
    registry.registerProvider(
      createProvider({ id: "qwen", apiKey: "sk-test" }),
    );

    let calls = 0;
    globalThis.fetch = (async () => {
      calls++;
      return jsonResponse(DEEPSEEK_PAYLOAD);
    }) as unknown as typeof fetch;

    const results = await collectProviderBalances();

    assert.strictEqual(
      calls,
      1,
      "only the provider with a documented balance API is queried",
    );
    assert.deepStrictEqual(
      results.map((r) => r.providerId),
      ["deepseek"],
    );
  });
});
