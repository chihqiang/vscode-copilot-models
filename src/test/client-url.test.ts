/**
 * Regression tests for API URL construction.
 *
 * Base URLs come from user settings, where a trailing slash is easy to type.
 * Concatenating it verbatim produced a double slash (`https://host/v1//chat/
 * completions`) — an empty path segment that some gateways reject with a 404.
 */

import * as assert from "assert";
import { joinApiUrl } from "../core/client";

const PATH = "/chat/completions";

suite("joinApiUrl Test Suite", () => {
  test("joins a plain base URL", () => {
    assert.strictEqual(
      joinApiUrl("https://api.deepseek.com", PATH),
      "https://api.deepseek.com/chat/completions",
    );
  });

  test("collapses trailing slashes on the base URL", () => {
    assert.strictEqual(
      joinApiUrl("https://api.deepseek.com/", PATH),
      "https://api.deepseek.com/chat/completions",
    );
    assert.strictEqual(
      joinApiUrl("https://api.deepseek.com///", PATH),
      "https://api.deepseek.com/chat/completions",
    );
  });

  test("keeps a versioned base path intact", () => {
    assert.strictEqual(
      joinApiUrl("https://open.bigmodel.cn/api/paas/v4/", PATH),
      "https://open.bigmodel.cn/api/paas/v4/chat/completions",
    );
  });

  test("tolerates surrounding whitespace and a path without a leading slash", () => {
    assert.strictEqual(
      joinApiUrl("  https://api.deepseek.com/  ", PATH),
      "https://api.deepseek.com/chat/completions",
    );
    assert.strictEqual(
      joinApiUrl("https://api.deepseek.com", "chat/completions"),
      "https://api.deepseek.com/chat/completions",
    );
  });

  test("supports a custom API path", () => {
    assert.strictEqual(
      joinApiUrl("https://gateway.example.com/v1/", "/completions/chat"),
      "https://gateway.example.com/v1/completions/chat",
    );
  });

  test("never emits a double slash", () => {
    for (const base of [
      "https://host",
      "https://host/",
      "https://host/v1",
      "https://host/v1/",
    ]) {
      assert.ok(
        !joinApiUrl(base, PATH).includes("//", 8),
        `double slash produced for base "${base}"`,
      );
    }
  });
});
