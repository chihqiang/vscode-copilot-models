/**
 * Regression tests for `getMaxImageSize` semantics.
 *
 * The setting is documented as "0 = disabled", meaning the size limit is
 * disabled. It used to be returned verbatim, and call sites compare
 * `imageByteLength > limit` — so configuring 0 silently rejected every image.
 */

import * as assert from "assert";
import * as vscode from "vscode";
import { getMaxImageSize } from "../core/settings";
import { CONFIG_SECTION } from "../core/models";

/** Write (or reset, when `value` is undefined) the setting for this test run. */
async function setMaxImageSize(value: number | undefined): Promise<void> {
  await vscode.workspace
    .getConfiguration(CONFIG_SECTION)
    .update("maxImageSize", value, vscode.ConfigurationTarget.Global);
}

suite("getMaxImageSize Test Suite", () => {
  teardown(async () => {
    await setMaxImageSize(undefined);
  });

  test("defaults to 20MB when unset", async () => {
    await setMaxImageSize(undefined);
    assert.strictEqual(getMaxImageSize(), 20 * 1024 * 1024);
  });

  test("returns a configured positive limit verbatim", async () => {
    await setMaxImageSize(1024);
    assert.strictEqual(getMaxImageSize(), 1024);
  });

  test("treats 0 as 'no limit' instead of 'reject every image'", async () => {
    await setMaxImageSize(0);
    const limit = getMaxImageSize();

    assert.strictEqual(limit, Infinity);
    // Call sites guard with `size > limit`; a huge image must pass.
    assert.strictEqual(
      50 * 1024 * 1024 > limit,
      false,
      "no image should be rejected when the limit is disabled",
    );
  });

  test("negative values are treated as 'no limit' too", async () => {
    await setMaxImageSize(-1);
    assert.strictEqual(getMaxImageSize(), Infinity);
  });
});
