import * as assert from 'assert';
import { countTokens, freeTokenizer } from '../core/tokenizer';

suite('Tokenizer Test Suite', () => {
  teardown(() => {
    // Ensure encoder is freed after each test
    freeTokenizer();
  });

  test('countTokens returns positive number for non-empty text', () => {
    const count = countTokens('Hello, world!');
    assert.ok(count > 0, `Expected positive token count, got ${count}`);
  });

  test('countTokens returns 0 for empty string', () => {
    const count = countTokens('');
    assert.strictEqual(count, 0);
  });

  test('countTokens handles Chinese text', () => {
    const count = countTokens('你好世界');
    assert.ok(count > 0, `Expected positive token count for Chinese text, got ${count}`);
  });

  test('countTokens handles long text', () => {
    const text = 'Hello, world! '.repeat(100);
    const count = countTokens(text);
    assert.ok(count > 10, `Expected reasonable token count, got ${count}`);
  });

  test('countTokens handles mixed content', () => {
    const text = 'Hello 你好 12345 !@#$%';
    const count = countTokens(text);
    assert.ok(count > 0, `Expected positive token count, got ${count}`);
  });

  test('freeTokenizer does not throw', () => {
    assert.doesNotThrow(() => freeTokenizer());
  });

  test('countTokens works after freeTokenizer (re-initialization)', () => {
    freeTokenizer();
    const count = countTokens('test after free');
    assert.ok(count > 0, `Expected positive token count after re-init, got ${count}`);
  });

  test('countTokens handles text with numbers', () => {
    const count = countTokens('12345 67890');
    assert.ok(count > 0, `Expected positive token count for numbers, got ${count}`);
  });
});
