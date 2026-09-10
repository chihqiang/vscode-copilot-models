import { defineConfig } from "@vscode/test-cli";

export default defineConfig({
  files: "out/test/**/*.test.js",
  /**
   * Disable all non-development extensions in the test host. VS Code's
   * built-in extensions (e.g. markdown, mermaid) create output channels
   * whose async init can race the extension-host teardown at the end of a
   * test run, producing "Trying to add a disposable to a DisposableStore
   * that has already been disposed of" warnings. These unit tests don't
   * need built-in extensions, so disabling them removes that noise.
   * The extension under test is loaded via --extensionDevelopmentPath and
   * is NOT affected.
   */
  launchArgs: ["--disable-extensions"],
});
