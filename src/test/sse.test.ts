import * as assert from 'assert';
import { LineDecoder, findDoubleNewlineIndex } from '../core/openai/decoders/line';
import { _iterSSEMessages, ServerSentEvent, Stream } from '../core/openai/stream';
import { encodeUTF8 } from '../core/openai/utils/bytes';

suite('LineDecoder Test Suite', () => {
  test('decodes lines with \\n endings', () => {
    const decoder = new LineDecoder();
    const lines = decoder.decode(encodeUTF8('line1\nline2\nline3\n'));
    assert.deepStrictEqual(lines, ['line1', 'line2', 'line3']);
  });

  test('decodes lines with \\r\\n endings', () => {
    const decoder = new LineDecoder();
    const lines = decoder.decode(encodeUTF8('line1\r\nline2\r\nline3\r\n'));
    assert.deepStrictEqual(lines, ['line1', 'line2', 'line3']);
  });

  test('decodes isolated \\r endings with flush', () => {
    const decoder = new LineDecoder();
    const lines = decoder.decode(encodeUTF8('line1\rline2\r'));
    const flushed = decoder.flush();
    assert.deepStrictEqual([...lines, ...flushed], ['line1', 'line2']);
  });

  test('handles mixed \\n and \\r\\n endings', () => {
    const decoder = new LineDecoder();
    const lines = decoder.decode(encodeUTF8('line1\r\nline2\nline3\r\n'));
    assert.deepStrictEqual(lines, ['line1', 'line2', 'line3']);
  });

  test('handles cross-chunk boundary lines', () => {
    const decoder = new LineDecoder();
    const lines1 = decoder.decode(encodeUTF8('hel'));
    assert.deepStrictEqual(lines1, []);
    const lines2 = decoder.decode(encodeUTF8('lo\nworld\n'));
    assert.deepStrictEqual(lines2, ['hello', 'world']);
  });

  test('handles empty input', () => {
    const decoder = new LineDecoder();
    const lines = decoder.decode(new Uint8Array([]));
    assert.deepStrictEqual(lines, []);
  });

  test('flush returns remaining content with trailing newline', () => {
    const decoder = new LineDecoder();
    decoder.decode(encodeUTF8('hello\nworld'));
    const flushed = decoder.flush();
    assert.deepStrictEqual(flushed, ['world']);
  });

  test('flush returns empty when buffer is empty', () => {
    const decoder = new LineDecoder();
    decoder.decode(encodeUTF8('hello\n'));
    const flushed = decoder.flush();
    assert.deepStrictEqual(flushed, []);
  });

  test('handles null/undefined chunk', () => {
    const decoder = new LineDecoder();
    assert.deepStrictEqual(decoder.decode(null), []);
    assert.deepStrictEqual(decoder.decode(undefined), []);
  });
});

suite('findDoubleNewlineIndex Test Suite', () => {
  test('finds \\n\\n', () => {
    const buf = encodeUTF8('data\n\n');
    assert.strictEqual(findDoubleNewlineIndex(buf), 6); // data(4) + \n(1) + \n(1) = 6
  });

  test('finds \\r\\r', () => {
    const buf = encodeUTF8('data\r\r');
    assert.strictEqual(findDoubleNewlineIndex(buf), 6);
  });

  test('finds \\r\\n\\r\\n', () => {
    const buf = encodeUTF8('data\r\n\r\n');
    // \r\n\r\n: d(1)a(2)t(3)a(4)\r(5)\n(6)\r(7)\n(8) → index = 8
    assert.strictEqual(findDoubleNewlineIndex(buf), 8);
  });

  test('returns -1 when no double newline', () => {
    const buf = encodeUTF8('hello world');
    assert.strictEqual(findDoubleNewlineIndex(buf), -1);
  });

  test('returns -1 for short buffer', () => {
    const buf = encodeUTF8('a');
    assert.strictEqual(findDoubleNewlineIndex(buf), -1);
  });

  test('finds double newline in middle of data', () => {
    const buf = encodeUTF8('header\n\nbody');
    assert.strictEqual(findDoubleNewlineIndex(buf), 8); // header(6) + \n(1) + \n(1) = 8
  });
});

suite('SSEDecoder (via _iterSSEMessages) Test Suite', () => {
  function createMockResponse(chunks: Uint8Array[]): Response {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) {
          controller.enqueue(chunk);
        }
        controller.close();
      },
    });
    return new Response(stream);
  }

  async function collectSSE(chunks: Uint8Array[]): Promise<ServerSentEvent[]> {
    const response = createMockResponse(chunks);
    const events: ServerSentEvent[] = [];
    const controller = new AbortController();

    for await (const sse of _iterSSEMessages(response, controller)) {
      events.push(sse);
    }

    return events;
  }

  test('parses single SSE event', async () => {
    const data = 'data: hello world\n\n';
    const events = await collectSSE([encodeUTF8(data)]);
    assert.strictEqual(events.length, 1);
    assert.strictEqual(events[0].data, 'hello world');
    assert.strictEqual(events[0].event, null);
  });

  test('parses event with type', async () => {
    const data = 'event: custom\ndata: payload\n\n';
    const events = await collectSSE([encodeUTF8(data)]);
    assert.strictEqual(events.length, 1);
    assert.strictEqual(events[0].event, 'custom');
    assert.strictEqual(events[0].data, 'payload');
  });

  test('parses multi-line data', async () => {
    const data = 'data: line1\ndata: line2\ndata: line3\n\n';
    const events = await collectSSE([encodeUTF8(data)]);
    assert.strictEqual(events.length, 1);
    assert.strictEqual(events[0].data, 'line1\nline2\nline3');
  });

  test('ignores comment lines', async () => {
    const data = ': comment\ndata: real\n\n';
    const events = await collectSSE([encodeUTF8(data)]);
    assert.strictEqual(events.length, 1);
    assert.strictEqual(events[0].data, 'real');
  });

  test('handles multiple events', async () => {
    const data = 'data: first\n\ndata: second\n\n';
    const events = await collectSSE([encodeUTF8(data)]);
    assert.strictEqual(events.length, 2);
    assert.strictEqual(events[0].data, 'first');
    assert.strictEqual(events[1].data, 'second');
  });

  test('parses cross-chunk SSE', async () => {
    const events = await collectSSE([
      encodeUTF8('data: par'),
      encodeUTF8('tial\n\n'),
    ]);
    assert.strictEqual(events.length, 1);
    assert.strictEqual(events[0].data, 'partial');
  });

  test('handles leading whitespace in value', async () => {
    const data = 'data: hello world\n\n';
    const events = await collectSSE([encodeUTF8(data)]);
    assert.strictEqual(events[0].data, 'hello world');
  });
});

suite('Stream.fromSSEResponse Test Suite', () => {
  function createMockSSEResponse(events: string[]): Response {
    const body = events.join('\n\n') + '\n\n';
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encodeUTF8(body));
        controller.close();
      },
    });
    return new Response(stream);
  }

  test('parses JSON data events', async () => {
    const response = createMockSSEResponse([
      'data: {"foo":"bar"}',
      'data: {"baz":"qux"}',
    ]);
    const controller = new AbortController();
    const stream = Stream.fromSSEResponse(response, controller);

    const results: any[] = [];
    for await (const item of stream) {
      results.push(item);
    }
    assert.strictEqual(results.length, 2);
    assert.deepStrictEqual(results[0], { foo: 'bar' });
    assert.deepStrictEqual(results[1], { baz: 'qux' });
  });

  test('skips [DONE] event', async () => {
    const response = createMockSSEResponse([
      'data: {"foo":"bar"}',
      'data: [DONE]',
      'data: {"should":"skip"}',
    ]);
    const controller = new AbortController();
    const stream = Stream.fromSSEResponse(response, controller);

    const results: any[] = [];
    for await (const item of stream) {
      results.push(item);
    }
    assert.strictEqual(results.length, 1);
    assert.deepStrictEqual(results[0], { foo: 'bar' });
  });

  test('throws on error event with error field', async () => {
    const response = createMockSSEResponse([
      'data: {"error":{"message":"API Error"}}',
    ]);
    const controller = new AbortController();
    const stream = Stream.fromSSEResponse(response, controller);

    let caught: Error | undefined;
    try {
      for await (const _item of stream) { /* noop */ }
    } catch (e) {
      caught = e as Error;
    }
    assert.ok(caught, 'Should throw on error response');
    assert.ok(caught!.message.includes('API Error'));
  });

  test('yields thread.* events with event type', async () => {
    const response = createMockSSEResponse([
      'event: thread.message\ndata: {"id":"123"}',
    ]);
    const controller = new AbortController();
    const stream = Stream.fromSSEResponse(response, controller);

    const results: any[] = [];
    for await (const item of stream) {
      results.push(item);
    }
    assert.strictEqual(results.length, 1);
    assert.strictEqual(results[0].event, 'thread.message');
    assert.deepStrictEqual(results[0].data, { id: '123' });
  });
});
