/**
 * Regression tests for the thinking-mode parameters.
 *
 * Every mistake here is silent. An API ignores a parameter it does not know,
 * so a level expressed the wrong way — or not expressed at all — leaves
 * thinking at its default rather than failing. Choosing "None" used to omit
 * the parameter entirely, and since the APIs default to thinking *on* that
 * made the option do nothing for every provider.
 *
 * Each format is checked for both halves: turning thinking off, and picking a
 * level. A format that handles only one of them is the bug being guarded.
 */

import * as assert from "assert";
import { applyThinkingParams } from "../core/chat-provider";
import type { ApiRequest } from "../core/client";
import type { ThinkingFormat } from "../core/models";
import { builtInProviders } from "../providers";

type ThinkingEffort = "none" | "low" | "high" | "max";

/** Apply one format and hand back the request, for field assertions. */
function apply(
  format: ThinkingFormat,
  effort: ThinkingEffort,
): Record<string, unknown> {
  const request = { model: "m", messages: [], stream: true } as ApiRequest;
  applyThinkingParams(request, format, effort);
  return request as unknown as Record<string, unknown>;
}

suite("thinking parameters Test Suite", () => {
  suite("reasoning_effort format", () => {
    test("'none' is sent, not omitted", () => {
      // The whole point: omitting the parameter leaves the API's default,
      // which is thinking on, so "None" silently did nothing.
      assert.strictEqual(
        apply("reasoning_effort", "none").reasoning_effort,
        "none",
      );
    });

    test("each level is passed through", () => {
      for (const effort of ["low", "high", "max"] as const) {
        assert.strictEqual(
          apply("reasoning_effort", effort).reasoning_effort,
          effort,
        );
      }
    });

    test("no toggle is sent alongside", () => {
      // This format carries both, and sending a second, contradicting
      // parameter is what makes behaviour depend on API precedence rules.
      const request = apply("reasoning_effort", "high");

      assert.strictEqual(request.thinking, undefined);
      assert.strictEqual(request.enable_thinking, undefined);
    });
  });

  suite("thinking_type format", () => {
    test("'none' disables the toggle", () => {
      assert.deepStrictEqual(apply("thinking_type", "none").thinking, {
        type: "disabled",
      });
    });

    test("a level enables the toggle", () => {
      for (const effort of ["low", "high", "max"] as const) {
        assert.deepStrictEqual(apply("thinking_type", effort).thinking, {
          type: "enabled",
        });
      }
    });

    test("no effort parameter is sent", () => {
      // This provider documents only the toggle. An effort value here would be
      // an unverified parameter on every request.
      assert.strictEqual(
        apply("thinking_type", "high").reasoning_effort,
        undefined,
      );
    });

    test("disabling sends nothing that would re-enable it", () => {
      const request = apply("thinking_type", "none");

      assert.strictEqual(request.reasoning_effort, undefined);
      assert.strictEqual(request.enable_thinking, undefined);
    });
  });

  suite("enable_thinking format", () => {
    test("'none' sets the boolean to false", () => {
      // DashScope defaults thinking to on for these models, so the boolean has
      // to be sent as false — the old code sent nothing at all here.
      const request = apply("enable_thinking", "none");

      assert.strictEqual(request.enable_thinking, false);
      assert.strictEqual(request.reasoning_effort, undefined);
    });

    test("a level sets the boolean to true", () => {
      for (const effort of ["low", "high", "max"] as const) {
        assert.strictEqual(
          apply("enable_thinking", effort).enable_thinking,
          true,
        );
      }
    });

    test("a level still sends the effort it always sent", () => {
      // This provider already sent the level this way; dropping it would be a
      // silent behaviour change beyond the reported bug.
      assert.strictEqual(
        apply("enable_thinking", "max").reasoning_effort,
        "max",
      );
    });

    test("no toggle of the other shape is sent", () => {
      assert.strictEqual(apply("enable_thinking", "high").thinking, undefined);
    });
  });

  test("every format can turn thinking off", () => {
    // The invariant, stated once: a format that cannot express "off" is the
    // defect this suite exists for.
    const formats: ThinkingFormat[] = [
      "reasoning_effort",
      "thinking_type",
      "enable_thinking",
    ];

    for (const format of formats) {
      const request = apply(format, "none");
      const expressed =
        request.reasoning_effort === "none" ||
        (request.thinking as { type?: string } | undefined)?.type ===
          "disabled" ||
        request.enable_thinking === false;

      assert.ok(expressed, `${format} cannot express "none"`);
    }
  });

  test("every format leaves other fields alone", () => {
    const request = apply("enable_thinking", "none");

    assert.strictEqual(request.model, "m");
    assert.strictEqual(request.stream, true);
  });
});

suite("provider thinking formats Test Suite", () => {
  test("Qwen declares the toggle its API documents", () => {
    // DashScope defaults thinking to on and documents `enable_thinking` as the
    // way to turn it off. Left on the default `reasoning_effort` format, the
    // "None" option sent nothing and thinking stayed on.
    const qwen = builtInProviders.find((p) => p.id === "qwen");

    assert.ok(qwen, "the Qwen provider must be registered");
    assert.strictEqual(qwen.thinkingFormat, "enable_thinking");
  });

  test("every declared format is one the converter implements", () => {
    // A typo here would silently fall through to the default branch, which
    // sends parameters the provider may not accept.
    const known: ThinkingFormat[] = [
      "reasoning_effort",
      "thinking_type",
      "enable_thinking",
    ];

    for (const provider of builtInProviders) {
      if (provider.thinkingFormat === undefined) {
        continue;
      }
      assert.ok(
        known.includes(provider.thinkingFormat),
        `"${provider.id}" declares unknown format "${provider.thinkingFormat}"`,
      );
    }
  });
});
