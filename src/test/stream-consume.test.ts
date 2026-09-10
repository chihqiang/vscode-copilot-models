/**
 * Regression tests for the OpenAI-compatible streaming consumer.
 *
 * These cover three behaviours that were previously broken and are easy to
 * regress silently, because a live gateway is needed to notice them:
 * - usage delivered in a trailing chunk with an empty `choices` array
 * - tool call fragments assembled across chunks
 * - tool calls flushed when the gateway omits `finish_reason`
 */

import * as assert from "assert";
import {
  consumeChatCompletionStream,
  type ApiToolCall,
  type ApiUsage,
  type StreamCallbacks,
} from "../core/client";
import { TimeoutError } from "../core/errors";
import type { ChatCompletionChunk } from "../core/sse";

const PROVIDER = "test-provider";

type Delta = NonNullable<ChatCompletionChunk["choices"][number]["delta"]>;

function makeChunk(
  delta: Delta,
  finishReason: string | null = null,
): ChatCompletionChunk {
  return {
    id: "chunk",
    object: "chat.completion.chunk",
    created: 0,
    model: "test-model",
    choices: [{ index: 0, delta, finish_reason: finishReason }],
  };
}

/** The trailing usage chunk required by `stream_options.include_usage`. */
function makeUsageChunk(usage: ApiUsage): ChatCompletionChunk {
  return {
    id: "chunk-usage",
    object: "chat.completion.chunk",
    created: 0,
    model: "test-model",
    choices: [],
    usage: {
      prompt_tokens: usage.prompt_tokens,
      completion_tokens: usage.completion_tokens,
      total_tokens: usage.total_tokens,
    },
  };
}

async function* streamOf(
  chunks: ChatCompletionChunk[],
): AsyncGenerator<ChatCompletionChunk> {
  for (const chunk of chunks) {
    yield chunk;
  }
}

interface Recorder {
  callbacks: StreamCallbacks;
  content: string[];
  thinking: string[];
  toolCalls: ApiToolCall[];
  usage: ApiUsage[];
  errors: Error[];
  doneCount: number;
}

function createRecorder(): Recorder {
  const recorder: Recorder = {
    content: [],
    thinking: [],
    toolCalls: [],
    usage: [],
    errors: [],
    doneCount: 0,
    callbacks: {
      onContent: () => {},
      onThinking: () => {},
      onToolCall: () => {},
      onError: () => {},
      onDone: () => {},
    },
  };

  recorder.callbacks = {
    onContent: (text) => recorder.content.push(text),
    onThinking: (text) => recorder.thinking.push(text),
    onToolCall: (toolCall) => recorder.toolCalls.push(toolCall),
    onError: (error) => recorder.errors.push(error),
    onDone: () => {
      recorder.doneCount++;
    },
    onUsage: (usage) => recorder.usage.push(usage),
  };

  return recorder;
}

suite("consumeChatCompletionStream Test Suite", () => {
  test("dispatches content and reasoning deltas", async () => {
    const recorder = createRecorder();

    await consumeChatCompletionStream(
      streamOf([
        makeChunk({ reasoning_content: "thinking" }),
        makeChunk({ content: "Hel" }),
        makeChunk({ content: "lo" }, "stop"),
      ]),
      recorder.callbacks,
      undefined,
      PROVIDER,
    );

    assert.deepStrictEqual(recorder.content, ["Hel", "lo"]);
    assert.deepStrictEqual(recorder.thinking, ["thinking"]);
    assert.strictEqual(recorder.errors.length, 0);
  });

  test("reports usage from the trailing chunk with empty choices", async () => {
    const recorder = createRecorder();

    const completed = await consumeChatCompletionStream(
      streamOf([
        makeChunk({ content: "hi" }, "stop"),
        makeUsageChunk({
          prompt_tokens: 11,
          completion_tokens: 7,
          total_tokens: 18,
        }),
      ]),
      recorder.callbacks,
      undefined,
      PROVIDER,
    );

    assert.strictEqual(completed, true);
    assert.strictEqual(
      recorder.usage.length,
      1,
      "usage chunk must not be dropped by the empty-choices guard",
    );
    assert.strictEqual(recorder.usage[0].total_tokens, 18);
  });

  test("assembles tool call fragments split across chunks", async () => {
    const recorder = createRecorder();

    await consumeChatCompletionStream(
      streamOf([
        makeChunk({
          tool_calls: [
            {
              index: 0,
              id: "call-1",
              type: "function",
              function: { name: "get_" },
            },
          ],
        }),
        makeChunk({
          tool_calls: [
            { index: 0, function: { name: "weather", arguments: '{"ci' } },
          ],
        }),
        makeChunk({
          tool_calls: [{ index: 0, function: { arguments: 'ty":"SF"}' } }],
        }),
        makeChunk({}, "tool_calls"),
      ]),
      recorder.callbacks,
      undefined,
      PROVIDER,
    );

    assert.strictEqual(recorder.toolCalls.length, 1);
    assert.strictEqual(recorder.toolCalls[0].id, "call-1");
    assert.strictEqual(recorder.toolCalls[0].function.name, "get_weather");
    assert.strictEqual(
      recorder.toolCalls[0].function.arguments,
      '{"city":"SF"}',
    );
  });

  test("flushes tool calls when the stream ends without finish_reason", async () => {
    const recorder = createRecorder();

    await consumeChatCompletionStream(
      streamOf([
        makeChunk({
          tool_calls: [
            {
              index: 0,
              id: "call-2",
              type: "function",
              function: { name: "read_file", arguments: "{}" },
            },
          ],
        }),
        makeUsageChunk({
          prompt_tokens: 1,
          completion_tokens: 1,
          total_tokens: 2,
        }),
      ]),
      recorder.callbacks,
      undefined,
      PROVIDER,
    );

    assert.strictEqual(
      recorder.toolCalls.length,
      1,
      "tool calls must not be dropped when finish_reason is missing",
    );
    assert.strictEqual(recorder.toolCalls[0].function.name, "read_file");
  });

  test("returns false and stops when cancelled", async () => {
    const recorder = createRecorder();
    const source = new (class {
      private calls = 0;
      cancelled = false;

      [Symbol.asyncIterator]() {
        return this;
      }

      async next(): Promise<IteratorResult<ChatCompletionChunk>> {
        this.calls++;
        // Cancel once the stream is being consumed.
        this.cancelled = true;
        return { value: makeChunk({ content: "x" }), done: false };
      }
    })();

    const token = {
      get isCancellationRequested() {
        return source.cancelled;
      },
      onCancellationRequested: () => ({ dispose: () => {} }),
    } as unknown as import("vscode").CancellationToken;

    const completed = await consumeChatCompletionStream(
      source,
      recorder.callbacks,
      token,
      PROVIDER,
    );

    assert.strictEqual(completed, false);
  });

  test("tolerates a final chunk that omits delta", async () => {
    const recorder = createRecorder();

    // Some gateways send `{"choices":[{"finish_reason":"stop"}]}` with no
    // delta object at all. Reading `"x" in delta` on undefined used to throw
    // a TypeError and abort the whole stream.
    const chunkWithoutDelta: ChatCompletionChunk = {
      id: "chunk-no-delta",
      object: "chat.completion.chunk",
      created: 0,
      model: "test-model",
      choices: [{ index: 0, finish_reason: "stop" }],
    };

    const completed = await consumeChatCompletionStream(
      streamOf([makeChunk({ content: "hi" }), chunkWithoutDelta]),
      recorder.callbacks,
      undefined,
      PROVIDER,
    );

    assert.strictEqual(completed, true);
    assert.deepStrictEqual(recorder.content, ["hi"]);
    assert.strictEqual(recorder.errors.length, 0);
  });

  test("aborts a stalled stream once the idle timeout elapses", async () => {
    const recorder = createRecorder();
    let idleFired = 0;

    // Emits one chunk, then never produces another — a gateway that accepted
    // the request and then silently stopped sending.
    const stalling: AsyncIterable<ChatCompletionChunk> = {
      [Symbol.asyncIterator]() {
        let sent = false;
        return {
          next(): Promise<IteratorResult<ChatCompletionChunk>> {
            if (!sent) {
              sent = true;
              return Promise.resolve({
                value: makeChunk({ content: "partial" }),
                done: false,
              });
            }
            return new Promise<IteratorResult<ChatCompletionChunk>>(() => {});
          },
        };
      },
    };

    await assert.rejects(
      () =>
        consumeChatCompletionStream(
          stalling,
          recorder.callbacks,
          undefined,
          PROVIDER,
          {
            idleTimeoutMs: 40,
            onIdleTimeout: () => {
              idleFired++;
            },
          },
        ),
      (err: unknown) => err instanceof TimeoutError,
    );

    assert.strictEqual(idleFired, 1, "the request must be aborted on stall");
    assert.deepStrictEqual(recorder.content, ["partial"]);
  });

  test("does not time out while chunks keep arriving", async () => {
    const recorder = createRecorder();
    let idleFired = 0;

    const completed = await consumeChatCompletionStream(
      streamOf([
        makeChunk({ content: "a" }),
        makeChunk({ content: "b" }),
        makeChunk({ content: "c" }, "stop"),
      ]),
      recorder.callbacks,
      undefined,
      PROVIDER,
      {
        idleTimeoutMs: 5_000,
        onIdleTimeout: () => {
          idleFired++;
        },
      },
    );

    assert.strictEqual(completed, true);
    assert.strictEqual(idleFired, 0);
  });
});
