import * as assert from 'assert';
import { concatBytes, encodeUTF8, decodeUTF8 } from '../core/openai/utils/bytes';

suite('bytes Test Suite', () => {
  test('concatBytes merges multiple Uint8Arrays', () => {
    const a = new Uint8Array([1, 2, 3]);
    const b = new Uint8Array([4, 5, 6]);
    const result = concatBytes([a, b]);
    assert.deepStrictEqual(Array.from(result), [1, 2, 3, 4, 5, 6]);
  });

  test('concatBytes handles single array', () => {
    const a = new Uint8Array([10, 20]);
    const result = concatBytes([a]);
    assert.deepStrictEqual(Array.from(result), [10, 20]);
  });

  test('concatBytes handles empty arrays', () => {
    const result = concatBytes([new Uint8Array([]), new Uint8Array([1]), new Uint8Array([])]);
    assert.deepStrictEqual(Array.from(result), [1]);
  });

  test('encodeUTF8 encodes ASCII string', () => {
    const result = encodeUTF8('Hello');
    assert.deepStrictEqual(Array.from(result), [72, 101, 108, 108, 111]);
  });

  test('encodeUTF8 encodes Chinese characters', () => {
    const result = encodeUTF8('你好');
    // UTF-8: 你 = E4 BD A0, 好 = E5 A5 BD
    assert.strictEqual(result.length, 6);
  });

  test('decodeUTF8 decodes ASCII bytes', () => {
    const bytes = new Uint8Array([72, 101, 108, 108, 111]);
    assert.strictEqual(decodeUTF8(bytes), 'Hello');
  });

  test('decodeUTF8 decodes Chinese bytes', () => {
    const bytes = encodeUTF8('你好');
    assert.strictEqual(decodeUTF8(bytes), '你好');
  });

  test('encodeUTF8 and decodeUTF8 are inverses', () => {
    const texts = ['Hello', '你好', 'Hello 你好 123!', '\n\r\t', '  '];
    for (const text of texts) {
      assert.strictEqual(decodeUTF8(encodeUTF8(text)), text);
    }
  });

  test('encodeUTF8 uses lazy singleton TextEncoder', () => {
    const r1 = encodeUTF8('a');
    const r2 = encodeUTF8('a');
    assert.deepStrictEqual(r1, r2);
  });

  test('decodeUTF8 uses lazy singleton TextDecoder', () => {
    const bytes = encodeUTF8('test');
    const r1 = decodeUTF8(bytes);
    const r2 = decodeUTF8(bytes);
    assert.strictEqual(r1, r2);
  });
});
