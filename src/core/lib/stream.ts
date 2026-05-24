/**
 * SSE stream parser
 *
 * Ported from OpenAI SDK v6.38.0, retaining only the minimal runtime code:
 * - Stream class: AsyncIterable wrapper with SSE parsing support
 * - SSEDecoder: line-by-line SSE protocol parser
 * - _iterSSEMessages: iterate SSE messages from Response body
 * - iterSSEChunks: handle chunked transfer encoding, split by double newlines
 * - readableStreamToAsyncIterable: bridge Web Stream to AsyncIterator
 * - LineDecoder: buffered line splitting for HTTP chunked transfer
 * - Byte utilities: Uint8Array merge, UTF-8 encode/decode
 */

import { logger } from './logger';

// ── Byte Utilities ──────────────────────────────────────

/** Merge multiple Uint8Arrays */
export function concatBytes(buffers: Uint8Array[]): Uint8Array {
  let length = 0;
  for (const buffer of buffers) {
    length += buffer.length;
  }
  const output = new Uint8Array(length);
  let index = 0;
  for (const buffer of buffers) {
    output.set(buffer, index);
    index += buffer.length;
  }
  return output;
}

let encodeUTF8_: (str: string) => Uint8Array;
/** Encode string to UTF-8 Uint8Array (lazy TextEncoder creation) */
export function encodeUTF8(str: string): Uint8Array {
  return (
    encodeUTF8_ ??
    ((encoder) => (encodeUTF8_ = encoder.encode.bind(encoder)))(new TextEncoder())
  )(str);
}

let decodeUTF8_: (bytes: Uint8Array) => string;
/** Decode UTF-8 Uint8Array to string (lazy TextDecoder creation) */
export function decodeUTF8(bytes: Uint8Array): string {
  return (
    decodeUTF8_ ??
    ((decoder) => (decodeUTF8_ = decoder.decode.bind(decoder)))(new TextDecoder())
  )(bytes);
}

// ── Line Decoder ────────────────────────────────────────

export type Bytes = string | ArrayBuffer | Uint8Array | null | undefined;

/**
 * Line decoder
 * Maintains internal buffer across chunks, correctly handles mixed \r and \r\n scenarios
 */
export class LineDecoder {
  static NEWLINE_CHARS = new Set(['\n', '\r']);
  static NEWLINE_REGEXP = /\r\n|[\n\r]/g;

  #buffer: Uint8Array;
  #carriageReturnIndex: number | null;

  constructor() {
    this.#buffer = new Uint8Array();
    this.#carriageReturnIndex = null;
  }

  decode(chunk: Bytes): string[] {
    if (chunk === null || chunk === undefined) {
      return [];
    }

    const binaryChunk =
      chunk instanceof ArrayBuffer ? new Uint8Array(chunk)
      : typeof chunk === 'string' ? encodeUTF8(chunk)
      : chunk;

    this.#buffer = concatBytes([this.#buffer, binaryChunk]);

    const lines: string[] = [];
    let patternIndex;
    while ((patternIndex = findNewlineIndex(this.#buffer, this.#carriageReturnIndex)) !== null) {
      if (patternIndex.carriage && this.#carriageReturnIndex === null) {
        this.#carriageReturnIndex = patternIndex.index;
        continue;
      }

      if (
        this.#carriageReturnIndex !== null &&
        (patternIndex.index !== this.#carriageReturnIndex + 1 || patternIndex.carriage)
      ) {
        lines.push(decodeUTF8(this.#buffer.subarray(0, this.#carriageReturnIndex - 1)));
        this.#buffer = this.#buffer.subarray(this.#carriageReturnIndex);
        this.#carriageReturnIndex = null;
        continue;
      }

      const endIndex =
        this.#carriageReturnIndex !== null ? patternIndex.preceding - 1 : patternIndex.preceding;

      const line = decodeUTF8(this.#buffer.subarray(0, endIndex));
      lines.push(line);

      this.#buffer = this.#buffer.subarray(patternIndex.index);
      this.#carriageReturnIndex = null;
    }

    return lines;
  }

  flush(): string[] {
    if (!this.#buffer.length) {
      return [];
    }
    return this.decode('\n');
  }
}

/** Find next newline position in buffer */
function findNewlineIndex(
  buffer: Uint8Array,
  startIndex: number | null,
): { preceding: number; index: number; carriage: boolean } | null {
  const newline = 0x0a;
  const carriage = 0x0d;

  for (let i = startIndex ?? 0; i < buffer.length; i++) {
    if (buffer[i] === newline) {
      return { preceding: i, index: i + 1, carriage: false };
    }

    if (buffer[i] === carriage) {
      return { preceding: i, index: i + 1, carriage: true };
    }
  }

  return null;
}

/** Find double newline position (\n\n, \r\r, or \r\n\r\n) for SSE chunk boundary detection */
export function findDoubleNewlineIndex(buffer: Uint8Array): number {
  const newline = 0x0a;
  const carriage = 0x0d;

  for (let i = 0; i < buffer.length - 1; i++) {
    if (buffer[i] === newline && buffer[i + 1] === newline) {
      return i + 2;
    }
    if (buffer[i] === carriage && buffer[i + 1] === carriage) {
      return i + 2;
    }
    if (
      buffer[i] === carriage &&
      buffer[i + 1] === newline &&
      i + 3 < buffer.length &&
      buffer[i + 2] === carriage &&
      buffer[i + 3] === newline
    ) {
      return i + 4;
    }
  }

  return -1;
}

// ── SSE Stream ──────────────────────────────────────────

/** SSE message structure */
export interface ServerSentEvent {
  event: string | null;
  data: string;
  raw: string[];
}

/**
 * Async iterable stream
 * Wraps SSE response, provides for await...of iteration interface
 */
export class Stream<Item> implements AsyncIterable<Item> {
  controller: AbortController;

  constructor(
    private iterator: () => AsyncIterator<Item>,
    controller: AbortController,
  ) {
    this.controller = controller;
  }

  /**
   * Create stream from HTTP Response
   * Parse SSE data, skip [DONE] marker and thread.* events,
   * JSON-parse data lines and yield them one by one
   */
  static fromSSEResponse<Item>(response: Response, controller: AbortController): Stream<Item> {
    let consumed = false;

    async function* iterator(): AsyncIterator<Item> {
      if (consumed) {
        throw new Error('Cannot iterate over a consumed stream, use `.tee()` to split the stream.');
      }
      consumed = true;
      let done = false;
      try {
        for await (const sse of _iterSSEMessages(response, controller)) {
          if (done) {continue;}

          if (sse.data.startsWith('[DONE]')) {
            done = true;
            continue;
          }

          if (sse.event === null || !sse.event.startsWith('thread.')) {
            let data: any;
            try {
              data = JSON.parse(sse.data);
            } catch (e) {
              logger.stream.error('Could not parse message into JSON:', sse.data);
              logger.stream.error('From chunk:', sse.raw);
              throw e;
            }

            if (data && data.error) {
              throw new Error(data.error.message || JSON.stringify(data.error));
            }

            yield data as Item;
          } else {
            let data: any;
            try {
              data = JSON.parse(sse.data);
            } catch (e) {
              logger.stream.error('Could not parse message into JSON:', sse.data);
              logger.stream.error('From chunk:', sse.raw);
              throw e;
            }
            if (sse.event === 'error') {
              throw new Error(data.error?.message || data.message || 'Unknown SSE error');
            }
            yield { event: sse.event, data } as any;
          }
        }
        done = true;
      } catch (e) {
        if (isAbortError(e)) {return;}
        throw e;
      } finally {
        if (!done) {controller.abort();}
      }
    }

    return new Stream(iterator, controller);
  }

  [Symbol.asyncIterator](): AsyncIterator<Item> {
    return this.iterator();
  }
}

/**
 * Iterate SSE messages from Response body
 * Combines LineDecoder (line splitting) and SSEDecoder (empty line splitting)
 */
export async function* _iterSSEMessages(
  response: Response,
  controller: AbortController,
): AsyncGenerator<ServerSentEvent> {
  if (!response.body) {
    controller.abort();
    throw new Error('Attempted to iterate over a response with no body');
  }

  const sseDecoder = new SSEDecoder();
  const lineDecoder = new LineDecoder();
  const iter = readableStreamToAsyncIterable<Uint8Array>(response.body);

  for await (const sseChunk of iterSSEChunks(iter)) {
    for (const line of lineDecoder.decode(sseChunk)) {
      const sse = sseDecoder.decode(line);
      if (sse) {yield sse;}
    }
  }

  for (const line of lineDecoder.flush()) {
    const sse = sseDecoder.decode(line);
    if (sse) {yield sse;}
  }
}

/**
 * Chunked transfer handling
 * Accumulates binary chunks, splits by double newlines (\n\n / \r\n\r\n) into individual SSE chunks
 */
async function* iterSSEChunks(iterator: AsyncIterableIterator<Uint8Array>): AsyncGenerator<Uint8Array> {
  let data = new Uint8Array();

  for await (const chunk of iterator) {
    if (chunk === null || chunk === undefined) {continue;}

    const binaryChunk =
      chunk instanceof ArrayBuffer ? new Uint8Array(chunk)
      : typeof chunk === 'string' ? encodeUTF8(chunk)
      : chunk;

    let newData = new Uint8Array(data.length + binaryChunk.length);
    newData.set(data);
    newData.set(binaryChunk, data.length);
    data = newData;

    let patternIndex;
    while ((patternIndex = findDoubleNewlineIndex(data)) !== -1) {
      yield data.slice(0, patternIndex);
      data = data.subarray(patternIndex);
    }
  }

  if (data.length > 0) {
    yield data;
  }
}

/**
 * SSE protocol decoder
 * Parses fields according to SSE specification
 */
class SSEDecoder {
  private data: string[];
  private event: string | null;
  private chunks: string[];

  constructor() {
    this.event = null;
    this.data = [];
    this.chunks = [];
  }

  decode(line: string) {
    if (line.endsWith('\r')) {
      line = line.substring(0, line.length - 1);
    }

    if (!line) {
      if (!this.event && !this.data.length) {return null;}

      const sse: ServerSentEvent = {
        event: this.event,
        data: this.data.join('\n'),
        raw: this.chunks,
      };

      this.event = null;
      this.data = [];
      this.chunks = [];

      return sse;
    }

    this.chunks.push(line);

    if (line.startsWith(':')) {return null;}

    let [fieldname, _, value] = partition(line, ':');

    if (value.startsWith(' ')) {
      value = value.substring(1);
    }

    if (fieldname === 'event') {
      this.event = value;
    } else if (fieldname === 'data') {
      this.data.push(value);
    }

    return null;
  }
}

/** Split string by delimiter */
function partition(str: string, delimiter: string): [string, string, string] {
  const index = str.indexOf(delimiter);
  if (index !== -1) {
    return [str.substring(0, index), delimiter, str.substring(index + delimiter.length)];
  }
  return [str, '', ''];
}

/**
 * Convert Web ReadableStream to AsyncIterableIterator
 * Bridges Web Streams API with for await...of syntax
 */
function readableStreamToAsyncIterable<T>(stream: ReadableStream<T>): AsyncIterableIterator<T> {
  if ((stream as any)[Symbol.asyncIterator]) {return stream as any;}

  const reader = stream.getReader();
  return {
    async next() {
      try {
        const result = await reader.read();
        if (result?.done) {reader.releaseLock();}
        return result;
      } catch (e) {
        reader.releaseLock();
        throw e;
      }
    },
    async return() {
      const cancelPromise = reader.cancel();
      reader.releaseLock();
      await cancelPromise;
      return { done: true, value: undefined as any };
    },
    [Symbol.asyncIterator]() {
      return this;
    },
  };
}

/** Check if error is an abort error */
function isAbortError(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    (('name' in err && (err as any).name === 'AbortError') ||
      ('message' in err && String((err as any).message).includes('FetchRequestCanceledException')))
  );
}
