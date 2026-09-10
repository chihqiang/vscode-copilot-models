import * as assert from "assert";
import * as vscode from "vscode";
import { logger } from "../core/logger";

suite("Extension Test Suite", () => {
  vscode.window.showInformationMessage("Start all tests.");

  test("Extension should be defined", () => {
    assert.ok(vscode, "vscode module should be available");
    assert.ok(vscode.workspace, "workspace should be available");
    assert.ok(vscode.window, "window should be available");
  });

  test("Commands should be registered", async () => {
    // Get all registered commands
    const commands = await vscode.commands.getCommands(true);

    // Check for expected commands
    assert.ok(
      commands.includes("copilot-models.setApiKey"),
      "setApiKey command should be registered",
    );
    assert.ok(
      commands.includes("copilot-models.clearApiKey"),
      "clearApiKey command should be registered",
    );
    assert.ok(
      commands.includes("copilot-models.openSettings"),
      "openSettings command should be registered",
    );
    assert.ok(
      commands.includes("copilot-models.refreshModels"),
      "refreshModels command should be registered",
    );
    assert.ok(
      commands.includes("copilot-models.showTokenUsage"),
      "showTokenUsage command should be registered",
    );
    assert.ok(
      commands.includes("copilot-models.clearTokenUsage"),
      "clearTokenUsage command should be registered",
    );
  });

  test("Extension configuration should exist", () => {
    const config = vscode.workspace.getConfiguration("copilot-models");

    assert.ok(config, "copilot-models configuration should exist");

    // Check default values
    assert.strictEqual(
      config.get<string>("deepseek.baseUrl"),
      "https://api.deepseek.com",
      "deepseek.baseUrl should have default value",
    );

    assert.deepStrictEqual(
      config.get<Record<string, string>>("modelIdOverrides"),
      {},
      "modelIdOverrides should default to empty object",
    );

    // The global `maxTokens` setting was removed — each model now uses its
    // own `maxOutputTokens`. Assert a still-existing token-related setting
    // instead.
    assert.strictEqual(
      config.get<number>("visionProxy.maxTokens"),
      1024,
      "visionProxy.maxTokens should default to 1024",
    );

    assert.strictEqual(
      config.get<boolean>("showStatusBar"),
      true,
      "showStatusBar should default to true",
    );
  });

  test("Language model chat provider should be registered", () => {
    // Check that deepseek provider is declared in package.json
    const packageJson = vscode.extensions.getExtension(
      "chihqiang.vscode-copilot-models",
    );
    assert.ok(packageJson, "Extension should be available");

    const contributes = packageJson.packageJSON.contributes;
    assert.ok(
      contributes.languageModelChatProviders,
      "languageModelChatProviders should be defined",
    );

    const providers = contributes.languageModelChatProviders as Array<{
      vendor: string;
      displayName: string;
    }>;
    assert.ok(providers.length > 0, "At least one provider should be declared");

    const deepseekProvider = providers.find((p) => p.vendor === "deepseek");
    assert.ok(deepseekProvider, "DeepSeek provider should be declared");
    assert.strictEqual(deepseekProvider.displayName, "DeepSeek");
  });

  test("Logger should be functional", async () => {
    // Test the extension's own logger. In test mode it writes to the
    // console instead of creating an OutputChannel — creating one here (as
    // the old test did via vscode.window.createOutputChannel) caused
    // "Trying to add a disposable to a DisposableStore that has already
    // been disposed of" warnings: the channel's async init completes after
    // the extension host tears down its DisposableStore.
    assert.doesNotThrow(() => {
      logger.core.info("Test log message");
      logger.core.warn("Test warning message");
      logger.core.error("Test error message");
    });
  });
});
