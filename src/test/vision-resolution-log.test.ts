/**
 * Tests for the vision diagnostic line.
 *
 * The stats behind this were computed on every image request and read by
 * nothing, so "the model never saw my image" left no trace in the log. The
 * line has to answer that question on its own, which puts two requirements on
 * it:
 *
 * - a request with images always states what became of each counter, including
 *   the ones that are zero — a field left out cannot be told apart from one
 *   that was never computed;
 * - a request the proxy deliberately skipped has to say so, because otherwise
 *   it reads as `described=0`, which is exactly what a failure looks like.
 *
 * It also has to stay silent when there are no images, since that is nearly
 * every request.
 */

import * as assert from "assert";
import * as vscode from "vscode";
import {
  formatVisionResolutionSummary,
  hasUndescribedImages,
  type VisionResolutionResult,
  type VisionResolutionStats,
} from "../core/vision";

function stats(
  patch: Partial<VisionResolutionStats> = {},
): VisionResolutionStats {
  return {
    inputImageParts: 1,
    inputImageMessages: 1,
    currentImageMessages: 1,
    generatedImageMessages: 0,
    unavailableImageMessages: 0,
    failedImageMessages: 0,
    omittedImageMessages: 0,
    droppedImageParts: 0,
    ...patch,
  };
}

function result(
  patch: Partial<VisionResolutionResult> = {},
): VisionResolutionResult {
  return {
    messages: [] as vscode.LanguageModelChatRequestMessage[],
    stats: stats(),
    ...patch,
  };
}

suite("vision resolution summary Test Suite", () => {
  test("says nothing about a request without images", () => {
    // The common case. A line here would drown the log this exists to make
    // readable, so the caller logs only when it gets a string back.
    assert.strictEqual(
      formatVisionResolutionSummary(
        result({
          stats: stats({
            inputImageParts: 0,
            inputImageMessages: 0,
            currentImageMessages: 0,
          }),
        }),
      ),
      undefined,
    );
  });

  test("reports a described image", () => {
    const line = formatVisionResolutionSummary(
      result({
        stats: stats({ generatedImageMessages: 1, droppedImageParts: 1 }),
        visionModelId: "vscode-lm:auto",
      }),
    );

    assert.ok(line, "a request with images must produce a line");
    assert.ok(line.includes("found=1"), line);
    assert.ok(line.includes("described=1"), line);
    assert.ok(line.includes("model=vscode-lm:auto"), line);
  });

  test("names every counter, including the zeroes", () => {
    // The line is read while asking why an image is missing. Omitting a
    // zero-valued field would make "nothing failed" indistinguishable from
    // "that counter was never reported".
    const line = formatVisionResolutionSummary(
      result({ stats: stats({ generatedImageMessages: 1 }) }),
    );

    for (const field of ["described=", "failed=", "unavailable=", "omitted="]) {
      assert.ok(line?.includes(field), `expected ${field} in "${line}"`);
    }
  });

  test("a skipped request says so instead of reporting zero described", () => {
    // The model takes images itself, so nothing was proxied. Without the
    // marker this reads as a failure: found=1 described=0.
    const line = formatVisionResolutionSummary(
      result({ stats: stats({ droppedImageParts: 1 }) }),
      { bypassed: true },
    );

    assert.ok(line?.includes("bypassed="), line);
    assert.ok(
      !line?.includes("described="),
      "counters that were never computed must not be reported",
    );
  });

  test("reports a failed description", () => {
    const line = formatVisionResolutionSummary(
      result({ stats: stats({ failedImageMessages: 1 }) }),
    );

    assert.ok(line?.includes("failed=1"), line);
  });

  test("reports that no describer was configured", () => {
    const line = formatVisionResolutionSummary(
      result({ stats: stats({ unavailableImageMessages: 1 }) }),
    );

    assert.ok(line?.includes("unavailable=1"), line);
  });

  test("reports an image left out because it belonged to an earlier turn", () => {
    const line = formatVisionResolutionSummary(
      result({
        stats: stats({
          generatedImageMessages: 1,
          omittedImageMessages: 1,
          inputImageParts: 2,
          inputImageMessages: 2,
        }),
      }),
    );

    assert.ok(line?.includes("omitted=1"), line);
    assert.ok(line?.includes("found=2"), line);
  });

  test("omits the model when none was used", () => {
    const line = formatVisionResolutionSummary(result());

    assert.ok(line?.startsWith("Image handling:"), line);
    assert.ok(!line?.includes("model="), line);
  });
});

suite("undescribed images predicate Test Suite", () => {
  test("a failure counts", () => {
    assert.strictEqual(
      hasUndescribedImages(stats({ failedImageMessages: 1 })),
      true,
    );
  });

  test("a missing describer counts", () => {
    assert.strictEqual(
      hasUndescribedImages(stats({ unavailableImageMessages: 1 })),
      true,
    );
  });

  test("a described image does not", () => {
    assert.strictEqual(
      hasUndescribedImages(stats({ generatedImageMessages: 1 })),
      false,
    );
  });

  test("an image omitted by design does not count", () => {
    // The proxy describes the current turn only, and the README says so. A
    // conversation that carries a past image would otherwise warn on every
    // single request.
    assert.strictEqual(
      hasUndescribedImages(stats({ omittedImageMessages: 1 })),
      false,
    );
  });

  test("no images at all does not count", () => {
    assert.strictEqual(
      hasUndescribedImages(stats({ inputImageParts: 0 })),
      false,
    );
  });
});
