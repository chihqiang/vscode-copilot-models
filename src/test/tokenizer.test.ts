import * as assert from "assert";
import { Tokenizer } from "../core/tokenizer";

suite("Tokenizer Test Suite", () => {
  let tokenizer: Tokenizer;

  setup(() => {
    tokenizer = Tokenizer.getInstance();
  });

  teardown(() => {
    tokenizer.dispose();
    Tokenizer.resetInstance();
  });

  test("countTokens returns positive number for non-empty text", () => {
    const count = tokenizer.countTokens("Hello, world!");
    assert.ok(count > 0, `Expected positive token count, got ${count}`);
  });

  test("countTokens returns 0 for empty string", () => {
    const count = tokenizer.countTokens("");
    assert.strictEqual(count, 0);
  });

  test("countTokens handles Chinese text", () => {
    const count = tokenizer.countTokens("你好世界");
    assert.ok(
      count > 0,
      `Expected positive token count for Chinese text, got ${count}`,
    );
  });

  test("countTokens handles long text", () => {
    const text = "Hello, world! ".repeat(100);
    const count = tokenizer.countTokens(text);
    assert.ok(count > 10, `Expected reasonable token count, got ${count}`);
  });

  test("countTokens handles mixed content", () => {
    const text = "Hello 你好 12345 !@#$%";
    const count = tokenizer.countTokens(text);
    assert.ok(count > 0, `Expected positive token count, got ${count}`);
  });

  test("dispose does not throw", () => {
    assert.doesNotThrow(() => tokenizer.dispose());
  });

  test("countTokens works after dispose (re-initialization)", () => {
    tokenizer.dispose();
    const fresh = Tokenizer.getInstance();
    const count = fresh.countTokens("test after free");
    assert.ok(
      count > 0,
      `Expected positive token count after re-init, got ${count}`,
    );
  });

  test("countTokens handles text with numbers", () => {
    const count = tokenizer.countTokens("12345 67890");
    assert.ok(
      count > 0,
      `Expected positive token count for numbers, got ${count}`,
    );
  });
});

/** Reach into the private memo so eviction behaviour is observable. */
interface TokenizerInternals {
  countCache: Map<string, number>;
  cachedChars: number;
}

function internalsOf(tokenizer: Tokenizer): TokenizerInternals {
  return tokenizer as unknown as TokenizerInternals;
}

suite("Tokenizer memoisation Test Suite", () => {
  let tokenizer: Tokenizer;

  setup(() => {
    tokenizer = Tokenizer.getInstance();
  });

  teardown(() => {
    tokenizer.dispose();
    Tokenizer.resetInstance();
  });

  test("a repeated count is served from the cache", () => {
    // VS Code re-counts every historical message on each turn, so the same
    // string arrives over and over.
    const text = "Hello, world! ".repeat(20);

    const first = tokenizer.countTokens(text);
    const second = tokenizer.countTokens(text);

    assert.strictEqual(second, first, "a cache hit must return the same count");
    assert.strictEqual(
      internalsOf(tokenizer).countCache.size,
      1,
      "the second call must not add another entry",
    );
  });

  test("the cache never exceeds its entry cap", () => {
    for (let i = 0; i < 600; i++) {
      tokenizer.countTokens(`message ${i} with a few words to encode`);
    }

    const { countCache } = internalsOf(tokenizer);
    assert.ok(countCache.size > 0, "the cache must actually be in use");
    assert.ok(
      countCache.size <= 512,
      `cache grew to ${countCache.size} entries`,
    );
  });

  test("the cache respects its retained-character budget", () => {
    // 25 x 45k chars is more than the 1M-character budget, so eviction must
    // kick in well before every entry is retained.
    const chunk = "word ".repeat(9_000);
    for (let i = 0; i < 25; i++) {
      tokenizer.countTokens(`${i}:${chunk}`);
    }

    const { cachedChars } = internalsOf(tokenizer);
    assert.ok(cachedChars > 0, "the cache must actually be in use");
    assert.ok(
      cachedChars <= 1_000_000,
      `retained ${cachedChars} characters, over the budget`,
    );
  });

  test("a text larger than the whole budget is not retained", () => {
    const huge = "a".repeat(1_000_001);
    tokenizer.countTokens(huge);

    assert.strictEqual(
      internalsOf(tokenizer).cachedChars,
      0,
      "caching a text that would be evicted immediately only wastes memory",
    );
  });

  test("dispose drops the cached counts", () => {
    tokenizer.countTokens("some text to remember");
    assert.strictEqual(internalsOf(tokenizer).countCache.size, 1);

    tokenizer.dispose();

    assert.strictEqual(internalsOf(tokenizer).countCache.size, 0);
    assert.strictEqual(internalsOf(tokenizer).cachedChars, 0);
  });

  test("cached and uncached counts agree", () => {
    const cached = "repeat me ".repeat(10);
    const cachedCount = tokenizer.countTokens(cached);
    tokenizer.countTokens(cached);

    // A fresh instance has an empty cache, so this encodes from scratch.
    Tokenizer.resetInstance();
    const fresh = Tokenizer.getInstance();
    try {
      assert.strictEqual(fresh.countTokens(cached), cachedCount);
    } finally {
      fresh.dispose();
      Tokenizer.resetInstance();
    }
  });
});
