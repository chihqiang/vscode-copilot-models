/**
 * Tests for log-line formatting.
 *
 * The logger's contract is one entry per line — that is what makes an output
 * channel greppable. An `Error` carries a multi-line stack, so logging one used
 * to emit a line per stack frame and break the contract.
 */

import * as assert from "assert";
import { formatLogArguments } from "../core/logger";

suite("formatLogArguments Test Suite", () => {
  test("passes strings through unchanged", () => {
    assert.strictEqual(formatLogArguments(["plain message"]), "plain message");
  });

  test("joins multiple arguments with a space", () => {
    assert.strictEqual(formatLogArguments(["first", "second"]), "first second");
  });

  test("renders an object as compact single-line JSON", () => {
    const out = formatLogArguments([{ model: "m1", stream: true }]);
    assert.strictEqual(out, '{"model":"m1","stream":true}');
    assert.ok(!out.includes("\n"));
  });

  test("collapses an error stack onto one line", () => {
    const error = new Error("boom");
    error.stack =
      "Error: boom\n    at first (/a.ts:1:1)\n    at second (/b.ts:2:2)";

    const out = formatLogArguments([error]);

    assert.ok(
      !out.includes("\n"),
      `one log entry must stay one line, got: ${out}`,
    );
    // The frames are still worth keeping, just not one line each.
    assert.ok(out.includes("boom"));
    assert.ok(out.includes("first (/a.ts:1:1)"));
    assert.ok(out.includes("second (/b.ts:2:2)"));
  });

  test("falls back to the message when a stack is absent", () => {
    const error = new Error("no stack here");
    // `stack` is not optional in the type, so clear it via defineProperty.
    Object.defineProperty(error, "stack", { value: undefined });
    assert.ok(formatLogArguments([error]).includes("no stack here"));
  });

  test("survives a value that cannot be serialized", () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;

    const out = formatLogArguments([circular]);
    assert.strictEqual(typeof out, "string");
    assert.ok(out.length > 0);
  });

  test("keeps mixed arguments on one line", () => {
    const error = new Error("failed");
    error.stack = "Error: failed\n    at handler (/h.ts:9:9)";

    const out = formatLogArguments(["request failed", error, { id: 7 }]);

    assert.ok(!out.includes("\n"));
    assert.ok(out.includes("request failed"));
    assert.ok(out.includes('{"id":7}'));
  });
});
