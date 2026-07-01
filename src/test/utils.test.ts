import * as assert from "assert";
import { sanitizeForLog, isSensitiveKey } from "../core/sanitize";

suite("Utility Functions Test Suite", () => {
  suite("sanitizeForLog", () => {
    test("should redact apiKey", () => {
      const obj = { apiKey: "sk-xxx", name: "test" };
      const result = sanitizeForLog(obj) as Record<string, unknown>;
      assert.strictEqual(result.apiKey, "[REDACTED]");
      assert.strictEqual(result.name, "test");
    });

    test("should redact api_key", () => {
      const obj = { api_key: "secret", value: 123 };
      const result = sanitizeForLog(obj) as Record<string, unknown>;
      assert.strictEqual(result.api_key, "[REDACTED]");
    });

    test("should redact api-key (hyphen variant)", () => {
      const obj = { "api-key": "secret", value: 123 };
      const result = sanitizeForLog(obj) as Record<string, unknown>;
      assert.strictEqual(result["api-key"], "[REDACTED]");
    });

    test("should redact authorization header", () => {
      const obj = { authorization: "Bearer token123", name: "test" };
      const result = sanitizeForLog(obj) as Record<string, unknown>;
      assert.strictEqual(result.authorization, "[REDACTED]");
    });

    test("should redact password", () => {
      const obj = { password: "secret123", username: "admin" };
      const result = sanitizeForLog(obj) as Record<string, unknown>;
      assert.strictEqual(result.password, "[REDACTED]");
      assert.strictEqual(result.username, "admin");
    });

    test("should redact token", () => {
      const obj = { token: "abc123", data: "visible" };
      const result = sanitizeForLog(obj) as Record<string, unknown>;
      assert.strictEqual(result.token, "[REDACTED]");
      assert.strictEqual(result.data, "visible");
    });

    test("should redact secret", () => {
      const obj = { secret: "hidden", public: "visible" };
      const result = sanitizeForLog(obj) as Record<string, unknown>;
      assert.strictEqual(result.secret, "[REDACTED]");
    });

    test("should redact nested sensitive keys", () => {
      const obj = {
        user: {
          name: "John",
          apiKey: "sk-secret",
        },
      };
      const result = sanitizeForLog(obj) as {
        user: Record<string, unknown>;
      };
      assert.strictEqual(result.user.name, "John");
      assert.strictEqual(result.user.apiKey, "[REDACTED]");
    });

    test("should handle arrays", () => {
      const obj = {
        users: [
          { name: "Alice", apiKey: "key1" },
          { name: "Bob", apiKey: "key2" },
        ],
      };
      const result = sanitizeForLog(obj) as {
        users: Array<Record<string, unknown>>;
      };
      assert.strictEqual(result.users[0].name, "Alice");
      assert.strictEqual(result.users[0].apiKey, "[REDACTED]");
      assert.strictEqual(result.users[1].name, "Bob");
      assert.strictEqual(result.users[1].apiKey, "[REDACTED]");
    });

    test("should return primitive values unchanged", () => {
      assert.strictEqual(sanitizeForLog("string"), "string");
      assert.strictEqual(sanitizeForLog(123), 123);
      assert.strictEqual(sanitizeForLog(true), true);
      assert.strictEqual(sanitizeForLog(null), null);
    });

    test("should handle empty objects", () => {
      const result = sanitizeForLog({});
      assert.deepStrictEqual(result, {});
    });

    test("should handle empty arrays", () => {
      const result = sanitizeForLog([]);
      assert.deepStrictEqual(result, []);
    });

    test("should redact Bearer token", () => {
      const obj = { bearer: "token123" };
      const result = sanitizeForLog(obj) as Record<string, unknown>;
      assert.strictEqual(result.bearer, "[REDACTED]");
    });

    test("should be case-insensitive for patterns", () => {
      const obj = { APIKEY: "secret", TOKEN: "abc", PASSWORD: "pass" };
      const result = sanitizeForLog(obj) as Record<string, unknown>;
      assert.strictEqual(result.APIKEY, "[REDACTED]");
      assert.strictEqual(result.TOKEN, "[REDACTED]");
      assert.strictEqual(result.PASSWORD, "[REDACTED]");
    });
  });

  suite("isSensitiveKey", () => {
    test("should identify apiKey as sensitive", () => {
      assert.strictEqual(isSensitiveKey("apiKey"), true);
      assert.strictEqual(isSensitiveKey("APIKEY"), true);
      assert.strictEqual(isSensitiveKey("apiKeyValue"), true);
    });

    test("should identify api_key as sensitive", () => {
      assert.strictEqual(isSensitiveKey("api_key"), true);
      assert.strictEqual(isSensitiveKey("deepseekApiKey"), true);
    });

    test("should identify api-key as sensitive (hyphen variant)", () => {
      assert.strictEqual(isSensitiveKey("api-key"), true);
    });

    test("should identify password as sensitive", () => {
      assert.strictEqual(isSensitiveKey("password"), true);
      assert.strictEqual(isSensitiveKey("userPassword"), true);
    });

    test("should identify token as sensitive", () => {
      assert.strictEqual(isSensitiveKey("token"), true);
      assert.strictEqual(isSensitiveKey("accessToken"), true);
    });

    test("should identify secret as sensitive", () => {
      assert.strictEqual(isSensitiveKey("secret"), true);
      assert.strictEqual(isSensitiveKey("appSecret"), true);
    });

    test("should identify authorization as sensitive", () => {
      assert.strictEqual(isSensitiveKey("authorization"), true);
      assert.strictEqual(isSensitiveKey("Authorization"), true);
    });

    test("should identify bearer as sensitive (no leading space)", () => {
      assert.strictEqual(isSensitiveKey("bearer"), true);
      assert.strictEqual(isSensitiveKey("Bearer"), true);
      assert.strictEqual(isSensitiveKey("x-bearer-token"), true);
    });

    test("should NOT flag non-sensitive keys", () => {
      assert.strictEqual(isSensitiveKey("name"), false);
      assert.strictEqual(isSensitiveKey("email"), false);
      assert.strictEqual(isSensitiveKey("username"), false);
      assert.strictEqual(isSensitiveKey("baseUrl"), false);
      assert.strictEqual(isSensitiveKey("model"), false);
    });
  });
});
