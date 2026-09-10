import * as assert from "assert";
import {
  sanitizeForLog,
  isSensitiveKey,
  redactSensitiveValues,
  sanitizeUrl,
} from "../core/sanitize";

suite("Sanitize - object key redaction", () => {
  test("redacts common sensitive keys", () => {
    const input = {
      model: "deepseek-flash",
      apiKey: "sk-abc",
      Authorization: "Bearer tok",
      stream: true,
    };
    const out = sanitizeForLog(input) as Record<string, unknown>;
    assert.strictEqual(out.model, "deepseek-flash");
    assert.strictEqual(out.stream, true);
    assert.strictEqual(out.apiKey, "[REDACTED]");
    assert.strictEqual(out.Authorization, "[REDACTED]");
  });

  test("redacts nested sensitive keys", () => {
    const input = {
      messages: [{ role: "user", content: "hi" }],
      headers: { "x-api-key": "secret", "x-model": "ok" },
    };
    const out = sanitizeForLog(input) as {
      headers: Record<string, unknown>;
    };
    assert.strictEqual(out.headers["x-api-key"], "[REDACTED]");
    assert.strictEqual(out.headers["x-model"], "ok");
  });

  test("keeps token counts and limits readable", () => {
    // Redacting these made the debug log for a token-usage feature useless:
    // the request body showed max_tokens as [REDACTED] and every usage total
    // disappeared.
    for (const key of [
      "max_tokens",
      "maxTokens",
      "prompt_tokens",
      "completion_tokens",
      "total_tokens",
      "promptTokens",
      "completionTokens",
      "totalTokens",
      "maxInputTokens",
      "maxOutputTokens",
      "reasoning_tokens",
    ]) {
      assert.strictEqual(
        isSensitiveKey(key),
        false,
        `${key} holds a count, not a secret`,
      );
    }
  });

  test("still redacts real token secrets", () => {
    // The allow-list must not widen into anything that can hold a credential.
    for (const key of [
      "access_token",
      "refresh_token",
      "authToken",
      "bearerToken",
      "apiToken",
      "id_token",
      "sessionToken",
      "token",
    ]) {
      assert.strictEqual(isSensitiveKey(key), true, `${key} must be redacted`);
    }
  });

  test("does not leak counts in a sanitized object", () => {
    const out = sanitizeForLog({
      model: "deepseek-flash",
      max_tokens: 64000,
      promptTokens: 900,
      totalTokens: 1500,
      apiKey: "sk-secret",
    }) as Record<string, unknown>;

    assert.strictEqual(out.max_tokens, 64000);
    assert.strictEqual(out.promptTokens, 900);
    assert.strictEqual(out.totalTokens, 1500);
    assert.strictEqual(out.apiKey, "[REDACTED]");
  });

  test("redacts keys with various spellings", () => {
    assert.ok(isSensitiveKey("apiKey"));
    assert.ok(isSensitiveKey("api_key"));
    assert.ok(isSensitiveKey("api-key"));
    assert.ok(isSensitiveKey("access_token"));
    assert.ok(isSensitiveKey("clientSecret"));
    assert.ok(isSensitiveKey("credential"));
    assert.ok(isSensitiveKey("cookie"));
    assert.ok(isSensitiveKey("sessionId"));
    assert.ok(isSensitiveKey("authorization"));
    assert.ok(!isSensitiveKey("model"));
    assert.ok(!isSensitiveKey("message"));
  });
});

suite("Sanitize - string value redaction", () => {
  test("redacts OpenAI-style prefixed keys", () => {
    const out = redactSensitiveValues("key is sk-1234567890abcdef");
    assert.ok(!out.includes("sk-1234567890abcdef"), `leaked: ${out}`);
    assert.ok(out.includes("[REDACTED]"), `no redaction: ${out}`);
  });

  test("redacts Bearer tokens", () => {
    const out = redactSensitiveValues("Authorization: Bearer abcdef123456");
    assert.ok(!out.includes("abcdef123456"), `leaked: ${out}`);
    assert.ok(out.includes("[REDACTED]"), `no redaction: ${out}`);
  });

  test("redacts key=value in query strings", () => {
    const out = redactSensitiveValues("https://host/v1?api_key=supersecret");
    assert.ok(!out.includes("supersecret"));
    assert.ok(out.includes("api_key=[REDACTED]"));
  });

  test("redacts key: value in JSON-style text", () => {
    const out = redactSensitiveValues('"apiKey":"secretvalue123"');
    assert.ok(!out.includes("secretvalue123"));
    assert.ok(out.includes("[REDACTED]"));
  });

  test("does not redact benign content", () => {
    const text =
      "model: deepseek-flash, messages: 3, stream: true, provider: deepseek";
    const out = redactSensitiveValues(text);
    assert.strictEqual(out, text);
  });

  test("does not redact token-plan identifier (word boundary)", () => {
    const out = redactSensitiveValues("via token-plan baseUrl=https://x/v1");
    // "token-plan" is not "token:" or "token=" so it must survive
    assert.ok(out.includes("token-plan"));
  });

  /**
   * Asserting only that the secret is gone cannot detect text the redactor
   * mangled. These assert the full output, because the previous implementation
   * ran every pattern through one callback and the patterns differ in capture
   * count: the offsets were read as capture groups and written into the log,
   * producing "Bearer 0[REDACTED]" and "key is 6[REDACTED]".
   */
  test("leaves surrounding text intact for a prefixed key", () => {
    assert.strictEqual(
      redactSensitiveValues("key is sk-1234567890abcdef"),
      "key is [REDACTED]",
    );
    assert.strictEqual(
      redactSensitiveValues("prefix sk-1234567890abcdef suffix"),
      "prefix [REDACTED] suffix",
    );
  });

  test("keeps the Bearer scheme when it is not a header value", () => {
    assert.strictEqual(
      redactSensitiveValues("using Bearer abcdefgh1234567 as header"),
      "using Bearer [REDACTED] as header",
    );
  });

  test("redacts both the Authorization value and the scheme inside it", () => {
    // Two placeholders, not one: the key/value rule redacts the header's value
    // ("Bearer ...") and the Bearer rule redacts the token within it. Redundant
    // but safe, and no offset leaks in as it did before.
    assert.strictEqual(
      redactSensitiveValues("Authorization: Bearer abcdef123456"),
      "Authorization: [REDACTED] [REDACTED]",
    );
  });

  test("redacts a prefixed key inside a Bearer header", () => {
    assert.strictEqual(
      redactSensitiveValues("Authorization: Bearer sk-abcdefgh12345678"),
      "Authorization: [REDACTED] [REDACTED]",
    );
  });

  test("redacts every occurrence in a longer message", () => {
    assert.strictEqual(
      redactSensitiveValues("a sk-aaaaaaaaaaaa b sk-bbbbbbbbbbbb"),
      "a [REDACTED] b [REDACTED]",
    );
  });

  test("is unaffected by how many times it has run", () => {
    // The rules are module-level regexes with the `g` flag, so a stale
    // lastIndex would make repeated calls skip matches.
    const text = "key is sk-1234567890abcdef";
    for (let i = 0; i < 3; i++) {
      assert.strictEqual(redactSensitiveValues(text), "key is [REDACTED]");
    }
  });
});

suite("Sanitize - URL redaction", () => {
  test("strips query string and fragment", () => {
    const out = sanitizeUrl(
      "https://host.example/v1/chat/completions?api_key=supersecret&x=1#frag",
    );
    assert.ok(!out.includes("supersecret"));
    assert.ok(!out.includes("?"), `unexpected query kept: ${out}`);
    assert.ok(!out.includes("#"), `unexpected fragment kept: ${out}`);
    assert.ok(out.includes("https://host.example/v1/chat/completions"));
  });

  test("keeps clean URLs intact", () => {
    assert.strictEqual(
      sanitizeUrl("https://api.deepseek.com"),
      "https://api.deepseek.com/",
    );
  });

  test("falls back to value redaction for invalid input", () => {
    const out = sanitizeUrl("not a url with sk-1234567890abcdef inside");
    assert.ok(!out.includes("sk-1234567890abcdef"));
  });
});
