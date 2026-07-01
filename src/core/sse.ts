/**
 * Server-Sent Events (SSE) streaming parser
 */

import { logger } from "./logger";
import { LineDecoder } from "./line-decoder";
import { encodeUTF8 } from "./bytes";
import { findDoubleNewlineIndex } from "./line-decoder";

/** Streaming chat completion response chunk */
export interface ChatCompletionChunk {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: Array<{
    index: number;
    delta: {
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
        throw new Error(
          "Cannot iterate over a consumed stream, use `.tee()` to split the stream.",
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

async function* iterSSEChunks(
  iterator: AsyncIterableIterator<Uint8Array>,
): AsyncGenerator<Uint8Array> {
  let buffer = new Uint8Array(0);

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

    const newBuffer = new Uint8Array(buffer.length + binaryChunk.length);
    newBuffer.set(buffer);
    newBuffer.set(binaryChunk, buffer.length);
    buffer = newBuffer;

    let patternIndex;
    while ((patternIndex = findDoubleNewlineIndex(buffer)) !== -1) {
      yield buffer.slice(0, patternIndex);
      buffer = buffer.subarray(patternIndex);
    }
  }

  if (buffer.length > 0) {
    yield buffer;
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
