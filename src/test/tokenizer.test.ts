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
