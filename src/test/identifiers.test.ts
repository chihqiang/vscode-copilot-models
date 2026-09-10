/**
 * Consistency between the identifiers in code and the extension manifest.
 *
 * package.json cannot import TypeScript, so every identifier the extension
 * exposes — command IDs, vendor IDs, setting keys — is necessarily written
 * twice: once in the manifest and once in code. Nothing in VS Code reports a
 * mismatch:
 *
 * - a command declared but not registered simply never appears in the palette;
 * - a command registered but not declared is invisible too;
 * - a vendor declared but not registered leaves the provider unselectable;
 * - a reader for an undeclared setting returns `undefined` forever, which looks
 *   like a broken feature rather than a typo.
 *
 * These tests are the only thing that fails when the two sides drift, and they
 * check both directions rather than only the manifest → VS Code one.
 */

import * as assert from "assert";
import * as vscode from "vscode";
import { ALL_COMMAND_IDS } from "../commands/command-ids";
import { ALL_SETTING_NAMES, settingKey } from "../core/settings";
import { CONFIG_SECTION, ROUTER_VENDOR_ID } from "../core/models";
import { builtInProviders } from "../providers";

interface PackageShape {
  contributes: {
    commands: Array<{ command: string }>;
    languageModelChatProviders: Array<{ vendor: string }>;
    configuration: { properties: Record<string, unknown> };
  };
}

function readManifest(): PackageShape {
  const extension = vscode.extensions.getExtension(
    "chihqiang.vscode-copilot-models",
  );
  assert.ok(extension, "the extension under test must be available");
  return extension.packageJSON as PackageShape;
}

suite("Identifier consistency Test Suite", () => {
  test("every command constant is declared in the manifest", () => {
    const declared = readManifest().contributes.commands.map((c) => c.command);

    const missing = ALL_COMMAND_IDS.filter((id) => !declared.includes(id));
    assert.deepStrictEqual(
      missing,
      [],
      "these commands exist in code but are not declared in package.json",
    );
  });

  test("every declared command has a constant in code", () => {
    const declared = readManifest().contributes.commands.map((c) => c.command);

    const orphaned = declared.filter((id) => !ALL_COMMAND_IDS.includes(id));
    assert.deepStrictEqual(
      orphaned,
      [],
      "these commands are declared in package.json but unknown to the code",
    );
  });

  test("every command constant is actually registered with VS Code", async () => {
    // This is the direction neither the manifest nor the constants can show:
    // registration happens at runtime, so a command that was declared and
    // constant-ified but never passed to registerCommand is silent everywhere
    // else.
    const registered = await vscode.commands.getCommands(true);

    const unregistered = ALL_COMMAND_IDS.filter(
      (id) => !registered.includes(id),
    );
    assert.deepStrictEqual(
      unregistered,
      [],
      "these commands are declared and constant-ified but never registered",
    );
  });

  test("no command is registered that the constants do not know about", async () => {
    // Catches a registerCommand call still passing a string literal, which
    // would escape both checks above.
    const registered = (await vscode.commands.getCommands(true)).filter((id) =>
      id.startsWith(`${CONFIG_SECTION}.`),
    );

    assert.deepStrictEqual(
      [...registered].sort(),
      [...ALL_COMMAND_IDS].sort(),
      "the commands registered at runtime must match the constants exactly",
    );
  });

  test("the router vendor is declared in the manifest", () => {
    const vendors = readManifest().contributes.languageModelChatProviders.map(
      (p) => p.vendor,
    );
    assert.ok(
      vendors.includes(ROUTER_VENDOR_ID),
      `"${ROUTER_VENDOR_ID}" must be declared in languageModelChatProviders`,
    );
  });

  test("every built-in provider is declared in the manifest", () => {
    // Declaring a provider the code does not register leaves it unselectable;
    // registering one the manifest omits is equally invisible. Provider data
    // lives in src/providers, so the manifest is the copy that can drift.
    const vendors = readManifest().contributes.languageModelChatProviders.map(
      (p) => p.vendor,
    );

    const undeclared = builtInProviders
      .map((p) => p.id)
      .filter((id) => !vendors.includes(id));
    assert.deepStrictEqual(undeclared, []);

    const expected = [...builtInProviders.map((p) => p.id), ROUTER_VENDOR_ID];
    assert.deepStrictEqual(
      [...vendors].sort(),
      [...expected].sort(),
      "the manifest must declare exactly the providers the code registers",
    );
  });

  test("every setting read in code is declared in the manifest", () => {
    // A reader for a key the manifest does not declare always returns the
    // default, so the setting silently has no effect. This is what caught the
    // class of bug where `affectsConfiguration` used a mistyped key.
    const declared = Object.keys(
      readManifest().contributes.configuration.properties,
    );

    const undeclared = ALL_SETTING_NAMES.map((name) => settingKey(name)).filter(
      (key) => !declared.includes(key),
    );
    assert.deepStrictEqual(
      undeclared,
      [],
      "these settings are read in code but not declared in package.json",
    );
  });

  test("settingKey expands names under the configuration section", () => {
    assert.strictEqual(
      settingKey("showStatusBar"),
      `${CONFIG_SECTION}.showStatusBar`,
    );
  });
});
