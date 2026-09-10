/**
 * Command IDs contributed by this extension.
 *
 * Each ID has to agree in three places: the `contributes.commands` entry in
 * package.json, the `registerCommand` call that registers it, and the
 * `vscode.commands.executeCommand` / status-bar wiring that invokes it. A typo
 * in either the manifest or the code produces a command that is announced but
 * never registered — or registered but absent from the palette — and VS Code
 * reports neither, so the failure is silent. Sharing the string removes the
 * code-side duplicates; `identifiers.test.ts` checks the manifest still agrees.
 */

export const COMMAND_SET_API_KEY = "copilot-models.setApiKey";
export const COMMAND_CLEAR_API_KEY = "copilot-models.clearApiKey";
export const COMMAND_OPEN_SETTINGS = "copilot-models.openSettings";
export const COMMAND_SHOW_LOG = "copilot-models.showLog";
export const COMMAND_CLEAR_LOG = "copilot-models.clearLog";
export const COMMAND_REFRESH_MODELS = "copilot-models.refreshModels";
export const COMMAND_SET_TOKEN_PLAN = "copilot-models.setTokenPlan";
export const COMMAND_CLEAR_TOKEN_PLAN = "copilot-models.clearTokenPlan";
export const COMMAND_SHOW_LATENCY_STATS = "copilot-models.showLatencyStats";
export const COMMAND_SHOW_TOKEN_USAGE = "copilot-models.showTokenUsage";
export const COMMAND_CLEAR_TOKEN_USAGE = "copilot-models.clearTokenUsage";
export const COMMAND_SET_VISION_MODEL = "copilot-models.setVisionModel";
export const COMMAND_CLEAR_VISION_MODEL = "copilot-models.clearVisionModel";

/**
 * Every command this extension registers.
 *
 * The registration code iterates this list implicitly by using the constants
 * above; keeping the collection here lets a test compare it against the
 * manifest and against the commands VS Code actually ended up with.
 */
export const ALL_COMMAND_IDS: readonly string[] = [
  COMMAND_SET_API_KEY,
  COMMAND_CLEAR_API_KEY,
  COMMAND_OPEN_SETTINGS,
  COMMAND_SHOW_LOG,
  COMMAND_CLEAR_LOG,
  COMMAND_REFRESH_MODELS,
  COMMAND_SET_TOKEN_PLAN,
  COMMAND_CLEAR_TOKEN_PLAN,
  COMMAND_SHOW_LATENCY_STATS,
  COMMAND_SHOW_TOKEN_USAGE,
  COMMAND_CLEAR_TOKEN_USAGE,
  COMMAND_SET_VISION_MODEL,
  COMMAND_CLEAR_VISION_MODEL,
];
