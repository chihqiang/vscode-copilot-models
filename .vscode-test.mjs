import { defineConfig } from "@vscode/test-cli";
import { existsSync, readdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * VS Code 1.110+ renamed the macOS main binary from `Electron` to the product
 * name (`Code`), and `@vscode/test-electron` < 3.0 hard-codes `Electron`,
 * which fails with `spawn .../Contents/MacOS/Electron ENOENT`.
 *
 * Instead of upgrading (3.x requires Node >= 22), point the runner at the
 * actual executable inside the downloaded app. Handles both the new `Code`
 * and legacy `Electron` names, and is resilient to version bumps since it
 * scans the `.vscode-test` directory dynamically.
 */
function resolveMacOSExecutable() {
  const testDir = join(__dirname, ".vscode-test");
  if (!existsSync(testDir)) {
    return undefined;
  }
  const candidates = readdirSync(testDir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && d.name.startsWith("vscode-darwin"))
    .sort()
    .reverse();
  for (const dir of candidates) {
    const macos = join(
      testDir,
      dir.name,
      "Visual Studio Code.app",
      "Contents",
      "MacOS",
    );
    for (const name of ["Code", "Electron"]) {
      const exe = join(macos, name);
      if (existsSync(exe)) {
        return exe;
      }
    }
  }
  return undefined;
}

const executable = resolveMacOSExecutable();

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
  ...(executable ? { useInstallation: { fromPath: executable } } : {}),
});
