/**
 * Regression tests for the request body sent to the API.
 *
 * Every field has to be listed deliberately when the body is built, and a
 * field left out is indistinguishable from one the API ignored. The thinking
 * controls — `thinking`, `enable_thinking`, `reasoning_effort` — were set on
 * the request and then dropped at this boundary for every provider, so the
 * whole thinking-mode setting did nothing and no error said so.
 *
 * `enable_thinking: false` deserves its own case: it is the value that turns
 * thinking off, so a truthiness check instead of an `undefined` check would
 * silently drop exactly the option users pick to disable reasoning.
 */

import * as assert from "assert";
import { buildChatRequestBody } from "../core/client";
import type { ApiRequest } from "../core/client";

function body(patch: Partial<ApiRequest> = {}): Record<string, unknown> {
  const request = {
    model: "test-model",
    messages: [{ role: "user", content: "hi" }],
    ...patch,
  } as ApiRequest;
  return buildChatRequestBody(request);
}

suite("chat request body Test Suite", () => {
  test("carries the model, the messages and the usage request", () => {
    const requestBody = body();

    assert.strictEqual(requestBody.model, "test-model");
    assert.strictEqual((requestBody.messages as unknown[]).length, 1);
    // Written by the builder, not read from the request: the client has no
    // way to consume a non-streaming response.
    assert.strictEqual(requestBody.stream, true);
    assert.deepStrictEqual(requestBody.stream_options, { include_usage: true });
  });

  test("sends the thinking toggle", () => {
    const requestBody = body({ thinking: { type: "disabled" } });

    assert.deepStrictEqual(requestBody.thinking, { type: "disabled" });
  });

  test("sends enable_thinking: false rather than dropping it", () => {
    // The one value that turns thinking off. A falsy check here would remove
    // the parameter and leave the API's default, which is thinking on.
    const requestBody = body({ enable_thinking: false });

    assert.strictEqual(requestBody.enable_thinking, false);
  });

  test("sends enable_thinking: true", () => {
    assert.strictEqual(body({ enable_thinking: true }).enable_thinking, true);
  });

  test("sends reasoning_effort, including the value that disables thinking", () => {
    assert.strictEqual(
      body({ reasoning_effort: "none" }).reasoning_effort,
      "none",
    );
    assert.strictEqual(
      body({ reasoning_effort: "max" }).reasoning_effort,
      "max",
    );
  });

  test("omits thinking controls the provider did not ask for", () => {
    // Absent must mean absent: an explicit `undefined` key reads the same
    // after serialisation but hides a provider that set the wrong format.
    const requestBody = body({ thinking: { type: "enabled" } });

    assert.strictEqual("enable_thinking" in requestBody, false);
    assert.strictEqual("reasoning_effort" in requestBody, false);
  });

  test("keeps the sampling and limit fields", () => {
    const requestBody = body({
      temperature: 0.2,
      top_p: 0.9,
      max_tokens: 1024,
    });

    assert.strictEqual(requestBody.temperature, 0.2);
    assert.strictEqual(requestBody.top_p, 0.9);
    assert.strictEqual(requestBody.max_tokens, 1024);
  });

  test("keeps the tool fields", () => {
    const requestBody = body({
      tools: [
        {
          type: "function",
          function: { name: "get_date", parameters: { type: "object" } },
        },
      ],
      tool_choice: "required",
    });

    assert.strictEqual((requestBody.tools as unknown[]).length, 1);
    assert.strictEqual(requestBody.tool_choice, "required");
  });

  test("carries thinking controls alongside tools", () => {
    // The realistic shape of a request: a tool-calling model that also has
    // thinking configured. Neither may push the other out.
    const requestBody = body({
      thinking: { type: "enabled" },
      tools: [
        {
          type: "function",
          function: { name: "get_date", parameters: { type: "object" } },
        },
      ],
      tool_choice: "auto",
    });

    assert.deepStrictEqual(requestBody.thinking, { type: "enabled" });
    assert.strictEqual((requestBody.tools as unknown[]).length, 1);
    assert.strictEqual(requestBody.tool_choice, "auto");
  });

  test("a caller-supplied stream_options wins", () => {
    const requestBody = body({ stream_options: { include_usage: false } });

    assert.deepStrictEqual(requestBody.stream_options, {
      include_usage: false,
    });
  });

  test("keeps reasoning content on assistant messages", () => {
    // The body builder converts messages; the conversion must not lose the
    // reasoning that providers require back when tools are in play.
    const requestBody = body({
      messages: [
        {
          role: "assistant",
          content: "",
          reasoning_content: "thinking",
          tool_calls: [
            {
              id: "call-1",
              type: "function",
              function: { name: "get_date", arguments: "{}" },
            },
          ],
        },
      ],
    });

    const [message] = requestBody.messages as Array<Record<string, unknown>>;
    assert.strictEqual(message.reasoning_content, "thinking");
    assert.strictEqual((message.tool_calls as unknown[]).length, 1);
  });
});
