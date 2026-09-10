/**
 * Server-Sent Events (SSE) streaming parser
 */

import { logger } from "./logger";
import { LineDecoder } from "./line-decoder";
import { encodeUTF8 } from "./bytes";

/** Streaming chat completion response chunk */
export interface ChatCompletionChunk {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: Array<{
    index: number;
    /**
     * Optional on purpose: some OpenAI-compatible gateways send a final chunk
     * carrying only `finish_reason` (e.g. `{"choices":[{"finish_reason":
     * "stop"}]}`), or an empty delta object. Consumers must tolerate both.
     */
    delta?: {
      content?: string | null;
      reasoning_content?: string;
      tool_calls?: Array<{
        index: number;
        id?: string;
        type?: string;
        function?: { name?: string; arguments?: string };
      }>;
    };
    finish_reason: string | null;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

export interface ServerSentEvent {
  event: string | null;
  data: string;
}

function parseSSEData(data: string): unknown {
  try {
    return JSON.parse(data);
  } catch (e) {
    logger.stream.error("Could not parse message into JSON:", data);
    throw e;
  }
}

export class Stream<Item> implements AsyncIterable<Item> {
  controller: AbortController;

  constructor(
    private iterator: () => AsyncIterator<Item>,
    controller: AbortController,
  ) {
    this.controller = controller;
  }

  static fromSSEResponse<Item>(
    response: Response,
    controller: AbortController,
  ): Stream<Item> {
    let consumed = false;

    async function* iterator(): AsyncIterator<Item> {
      if (consumed) {
        // No `.tee()` here, unlike the SDK this was adapted from: the stream
        // wraps one HTTP response and cannot be split. Suggesting a method
        // this class does not have sent callers to a TypeError.
        throw new Error(
          "Cannot iterate over a consumed stream: it wraps a single HTTP response and cannot be replayed",
        );
      }
      consumed = true;
      let done = false;
      try {
        for await (const sse of _iterSSEMessages(response, controller)) {
          if (done) {
            continue;
          }

          if (sse.data.startsWith("[DONE]")) {
            done = true;
            continue;
          }

          const data = parseSSEData(sse.data);

          if (sse.event !== null && sse.event.startsWith("thread.")) {
            if (sse.event === "error") {
              const d = data as Record<string, unknown>;
              const err = d.error as Record<string, unknown> | undefined;
              throw new Error(
                (err?.message as string) ||
                  (d.message as string) ||
                  "Unknown SSE error",
              );
            }
            yield { event: sse.event, data } as Item;
          } else {
            if (
              data &&
              typeof data === "object" &&
              "error" in data &&
              data.error
            ) {
              const err = data.error as Record<string, unknown>;
              throw new Error(
                (err.message as string) || JSON.stringify(data.error),
              );
            }
            yield data as Item;
          }
        }
        done = true;
      } catch (e) {
        if (isAbortError(e)) {
          return;
        }
        throw e;
      } finally {
        if (!done) {
          controller.abort();
        }
      }
    }

    return new Stream(iterator, controller);
  }

  [Symbol.asyncIterator](): AsyncIterator<Item> {
    return this.iterator();
  }
}

export async function* _iterSSEMessages(
  response: Response,
  controller: AbortController,
): AsyncGenerator<ServerSentEvent> {
  if (!response.body) {
    controller.abort();
    throw new Error("Attempted to iterate over a response with no body");
  }

  const sseDecoder = new SSEDecoder();
  const lineDecoder = new LineDecoder();
  const iter = readableStreamToAsyncIterable<Uint8Array>(response.body);

  for await (const sseChunk of iterSSEChunks(iter)) {
    for (const line of lineDecoder.decode(sseChunk)) {
      const sse = sseDecoder.decode(line);
      if (sse) {
        yield sse;
      }
    }
  }

  for (const line of lineDecoder.flush()) {
    const sse = sseDecoder.decode(line);
    if (sse) {
      yield sse;
    }
  }
}

/**
 * Split the raw byte stream into SSE event chunks (each ending with a blank
 * line: \n\n, \r\r, or \r\n\r\n).
 *
 * Uses a segmented buffer with a persistent scan cursor so every buffered
 * byte is examined at most once (amortized O(1) per byte), avoiding the
 * O(n²) full-buffer copies of a naive concat-and-rescan approach. Emitted
 * bytes are dropped periodically to bound memory usage.
 */
const COMPACT_THRESHOLD = 64 * 1024;
const MAX_SEGMENTS = 32;

async function* iterSSEChunks(
  iterator: AsyncIterableIterator<Uint8Array>,
): AsyncGenerator<Uint8Array> {
  const segments: Uint8Array[] = [];
  let totalLength = 0;
  let start = 0; // global index of the first un-emitted byte

  // Persistent scan cursor. It only rewinds during compaction, so each
  // buffered byte is inspected at most once.
  let segIdx = 0;
  let byteIdx = 0;
  let g = 0; // global index of the next byte to scan
  let prev3 = -1;
  let prev2 = -1;
  let prev1 = -1;

  /** Read the next byte at the scan cursor, or -1 when exhausted. */
  const scanNext = (): number => {
    while (segIdx < segments.length) {
      const seg = segments[segIdx];
      if (byteIdx < seg.length) {
        return seg[byteIdx++];
      }
      segIdx++;
      byteIdx = 0;
    }
    return -1;
  };

  /** Copy bytes [from, to) out of the segment list. */
  const extract = (from: number, to: number): Uint8Array => {
    const out = new Uint8Array(to - from);
    let outPos = 0;
    let skip = from;
    for (const seg of segments) {
      if (skip >= seg.length) {
        skip -= seg.length;
        continue;
      }
      const take = Math.min(seg.length - skip, out.length - outPos);
      out.set(seg.subarray(skip, skip + take), outPos);
      outPos += take;
      if (outPos === out.length) {
        break;
      }
      skip = 0;
    }
    return out;
  };

  /** Drop the first `count` bytes to bound memory usage. */
  const dropBytes = (count: number): void => {
    let remaining = count;
    while (remaining > 0 && segments.length > 0) {
      const seg = segments[0];
      if (seg.length <= remaining) {
        remaining -= seg.length;
        segments.shift();
      } else {
        segments[0] = seg.subarray(remaining);
        remaining = 0;
      }
    }
    totalLength -= count - remaining;
  };

  for await (const chunk of iterator) {
    if (chunk === null || chunk === undefined) {
      continue;
    }

    const binaryChunk =
      chunk instanceof ArrayBuffer
        ? new Uint8Array(chunk)
        : typeof chunk === "string"
          ? encodeUTF8(chunk)
          : chunk;

    if (binaryChunk.length === 0) {
      continue;
    }

    // Periodically drop already-emitted bytes and rewind the scan cursor.
    if (
      start > 0 &&
      (start > COMPACT_THRESHOLD || segments.length > MAX_SEGMENTS)
    ) {
      dropBytes(start);
      start = 0;
      segIdx = 0;
      byteIdx = 0;
      g = 0;
      prev1 = -1;
      prev2 = -1;
      prev3 = -1;
    }

    segments.push(binaryChunk);
    totalLength += binaryChunk.length;

    // Scan newly available bytes for the first complete event boundary.
    while (true) {
      const b = scanNext();
      if (b === -1) {
        break;
      }
      // b is at global index g. Detect a blank-line boundary:
      //   \n\n         (prev1 = \n)
      //   \r\r         (prev1 = \r)
      //   \r\n\r\n     (prev3 = \r, prev2 = \n, prev1 = \r)
      if (
        (prev1 === 0x0a && b === 0x0a) ||
        (prev1 === 0x0d && b === 0x0d) ||
        (prev3 === 0x0d && prev2 === 0x0a && prev1 === 0x0d && b === 0x0a)
      ) {
        const end = g + 1;
        yield extract(start, end);
        start = end;
      }
      prev3 = prev2;
      prev2 = prev1;
      prev1 = b;
      g++;
    }
  }

  // Flush any trailing un-emitted bytes.
  if (start < totalLength) {
    yield extract(start, totalLength);
  }
}

class SSEDecoder {
  private data: string[];
  private event: string | null;

  constructor() {
    this.event = null;
    this.data = [];
  }

  decode(line: string) {
    if (line.endsWith("\r")) {
      line = line.substring(0, line.length - 1);
    }

    if (!line) {
      if (!this.event && !this.data.length) {
        return null;
      }

      const sse: ServerSentEvent = {
        event: this.event,
        data: this.data.join("\n"),
      };

      this.event = null;
      this.data = [];

      return sse;
    }

    if (line.startsWith(":")) {
      return null;
    }

    const [fieldname, , rawValue] = partition(line, ":");
    const value = rawValue.startsWith(" ") ? rawValue.substring(1) : rawValue;

    if (fieldname === "event") {
      this.event = value;
    } else if (fieldname === "data") {
      this.data.push(value);
    }

    return null;
  }
}

function partition(str: string, delimiter: string): [string, string, string] {
  const index = str.indexOf(delimiter);
  if (index !== -1) {
    return [
      str.substring(0, index),
      delimiter,
      str.substring(index + delimiter.length),
    ];
  }
  return [str, "", ""];
}

function readableStreamToAsyncIterable<T>(
  stream: ReadableStream<T>,
): AsyncIterableIterator<T> {
  if ((stream as any)[Symbol.asyncIterator]) {
    return stream as any;
  }

  const reader = stream.getReader();
  return {
    async next() {
      try {
        const result = await reader.read();
        if (result?.done) {
          reader.releaseLock();
        }
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
      return { done: true as const, value: undefined as never };
    },
    [Symbol.asyncIterator]() {
      return this;
    },
  };
}

export function isAbortError(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    (("name" in err &&
      (err as Record<string, unknown>).name === "AbortError") ||
      ("message" in err &&
        String((err as Record<string, unknown>).message).includes(
          "FetchRequestCanceledException",
        )))
  );
}
