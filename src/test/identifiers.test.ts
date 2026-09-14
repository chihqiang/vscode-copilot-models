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
import * as fs from "fs";
import * as path from "path";
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

  test("the manifest declares no vendor that serves nothing", async () => {
    // A declared vendor that never registers is the case the old assertion
    // described without checking. It compared the manifest against
    // `builtInProviders` while the code registers only the router, so it
    // passed for the wrong reason — and the three extra vendors are dead
    // weight: `getVendors()` hands them to every caller that looks a vendor up
    // by name. The reality is read from the models VS Code can see.
    const declared = readManifest().contributes.languageModelChatProviders.map(
      (p) => p.vendor,
    );
    const served = new Set(
      (await vscode.lm.selectChatModels()).map((m) => m.vendor),
    );

    assert.deepStrictEqual(
      declared.filter((vendor) => !served.has(vendor)),
      [],
      "these vendors are declared in package.json but serve no model",
    );
  });

  test("every built-in model is served by a registered vendor", async () => {
    // Stated as the requirement the declarations exist to satisfy: a model the
    // provider data promises has to be reachable. Asserting it through
    // `builtInProviders` proved nothing, because that list is the thing that
    // has to be reachable.
    const servedIds = new Set(
      (await vscode.lm.selectChatModels()).map((m) => m.id),
    );

    const missing = builtInProviders
      .flatMap((provider) => provider.models.map((model) => model.id))
      .filter((id) => !servedIds.has(id));

    assert.deepStrictEqual(
      missing,
      [],
      "these models are configured in src/providers but unreachable in VS Code",
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

  test("the chatProvider proposal is declared for the edit-tool hint", () => {
    // Unlike most fields a provider returns, `capabilities.editTools` is
    // gated in the extension host with `checkProposedApiEnabled`, which
    // *throws*. Reporting the hint without this declaration does not degrade
    // gracefully: model discovery fails and the provider disappears from the
    // picker. The proposal also gates `requiresAuthorization` and `isDefault`,
    // neither of which this extension sets.
    //
    // Read from the file rather than from `extension.packageJSON`: VS Code
    // consumes `enabledApiProposals` while loading the extension and does not
    // pass it on to the manifest extensions see at runtime.
    const extension = vscode.extensions.getExtension(
      "chihqiang.vscode-copilot-models",
    );
    assert.ok(extension, "the extension under test must be available");
    const manifest = JSON.parse(
      fs.readFileSync(
        path.join(extension.extensionPath, "package.json"),
        "utf8",
      ),
    ) as { enabledApiProposals?: string[] };

    assert.ok(
      manifest.enabledApiProposals?.includes("chatProvider"),
      "capabilities.editTools requires the chatProvider proposal to be listed in enabledApiProposals",
    );
  });

  test("the documented utility-model value names the vendor that serves the models", () => {
    // `chat.utilitySmallModel` is matched by exactly `<vendor>/<model-id>`, and
    // the vendor VS Code reports is the one that *registered* the provider —
    // the router — not the upstream service a model is named after. Documenting
    // `deepseek/deepseek-flash` therefore described a value the editor silently
    // ignores, which is worse than an obvious error: nothing reports a
    // non-matching override except a log line.
    const extension = vscode.extensions.getExtension(
      "chihqiang.vscode-copilot-models",
    );
    assert.ok(extension, "the extension under test must be available");

    for (const file of ["README.md", "README.zh-CN.md"]) {
      const text: string = fs.readFileSync(
        path.join(extension.extensionPath, file),
        "utf8",
      );
      const example: RegExpMatchArray | null = text.match(
        /"chat\.utilitySmallModel"\s*:\s*"([^"\/]+)\/([^"]+)"/,
      );

      assert.ok(example, `${file} must show a chat.utilitySmallModel example`);
      assert.strictEqual(
        example[1],
        ROUTER_VENDOR_ID,
        `${file} documents "${example[1]}/..." but the models are served by "${ROUTER_VENDOR_ID}"`,
      );
    }
  });
});
