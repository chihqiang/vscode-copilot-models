/**
 * Centralized settings access for the `copilot-models` configuration section.
 *
 * All core modules read configuration through this facade instead of
 * repeating `vscode.workspace.getConfiguration(CONFIG_SECTION)` boilerplate,
 * so configuration keys and their defaults live in one place.
 *
 * The key names are exported too, for the call sites that need a full key
 * rather than a value — `affectsConfiguration` and the wizard's `update`
 * calls. Writing those as literals duplicated the name across files, so
 * renaming a key in one place left the other silently inert: a mistyped
 * `affectsConfiguration` argument simply never matches, and the change it was
 * meant to react to stops arriving with no error anywhere.
 */
import vscode from "vscode";
import { CONFIG_SECTION, type RoutingStrategy } from "./models";

/** Get the copilot-models WorkspaceConfiguration */
export function getConfig(): vscode.WorkspaceConfiguration {
  return vscode.workspace.getConfiguration(CONFIG_SECTION);
}

/**
 * Expand a setting name to its full configuration key.
 *
 * `affectsConfiguration` and `WorkspaceConfiguration.update` need the
 * `copilot-models.` prefix, while `get`/`has` take the bare name.
 */
export function settingKey(name: string): string {
  return `${CONFIG_SECTION}.${name}`;
}

// ── Global setting names ─────────────────────────────

export const SETTING_DEBUG_MODE = "debugMode";
export const SETTING_TIMEOUT_MS = "timeoutMs";
export const SETTING_MAX_RETRIES = "maxRetries";
export const SETTING_MODEL_ID_OVERRIDES = "modelIdOverrides";
export const SETTING_MAX_IMAGE_SIZE = "maxImageSize";
export const SETTING_SHOW_STATUS_BAR = "showStatusBar";
export const SETTING_ROUTING_STRATEGY = "routingStrategy";
export const SETTING_FAILOVER_MODELS = "failoverModels";

// ── Vision proxy setting names ───────────────────────

export const SETTING_VISION_MODEL = "visionModel";
export const SETTING_VISION_PROMPT = "visionPrompt";
export const SETTING_VISION_PROXY_API_URL = "visionProxy.apiUrl";
export const SETTING_VISION_PROXY_API_MODEL_ID = "visionProxy.apiModelId";
export const SETTING_VISION_PROXY_TIMEOUT_MS = "visionProxy.timeoutMs";
export const SETTING_VISION_PROXY_MAX_TOKENS = "visionProxy.maxTokens";

/**
 * Every global setting this module reads.
 *
 * Lets a test check each one is actually declared in package.json — a reader
 * for an undeclared key returns `undefined` forever and looks like a broken
 * feature rather than a typo.
 */
export const ALL_SETTING_NAMES: readonly string[] = [
  SETTING_DEBUG_MODE,
  SETTING_TIMEOUT_MS,
  SETTING_MAX_RETRIES,
  SETTING_MODEL_ID_OVERRIDES,
  SETTING_MAX_IMAGE_SIZE,
  SETTING_SHOW_STATUS_BAR,
  SETTING_ROUTING_STRATEGY,
  SETTING_FAILOVER_MODELS,
  SETTING_VISION_MODEL,
  SETTING_VISION_PROMPT,
  SETTING_VISION_PROXY_API_URL,
  SETTING_VISION_PROXY_API_MODEL_ID,
  SETTING_VISION_PROXY_TIMEOUT_MS,
  SETTING_VISION_PROXY_MAX_TOKENS,
];

// ── Readers ──────────────────────────────────────────

/** API request timeout in milliseconds (default: 60000) */
export function getTimeoutMs(): number {
  return getConfig().get<number>(SETTING_TIMEOUT_MS) ?? 60_000;
}

/** Maximum number of API request retries (default: 1) */
export function getMaxRetries(): number {
  return getConfig().get<number>(SETTING_MAX_RETRIES) ?? 1;
}

/** Log verbosity: minimal / metadata / verbose */
export function getDebugMode(): string | undefined {
  return getConfig().get<string>(SETTING_DEBUG_MODE);
}

/**
 * Maximum image upload size in bytes (default: 20MB).
 *
 * `0` means the limit is disabled, so `Infinity` is returned and every image
 * is accepted. Previously `0` was compared directly (`size > 0`), which
 * silently rejected every image — the opposite of what "0 = disabled" implies.
 * Callers only need a `>` / `<=` comparison, so a non-finite limit is fine.
 */
export function getMaxImageSize(): number {
  const configured = getConfig().get<number>(SETTING_MAX_IMAGE_SIZE);
  if (configured === undefined || configured === null) {
    return 20 * 1024 * 1024;
  }
  return configured <= 0 ? Infinity : configured;
}

/** Override map: model ID → custom API model name */
export function getModelIdOverrides(): Record<string, string> {
  return getConfig().get<Record<string, string>>(
    SETTING_MODEL_ID_OVERRIDES,
    {},
  );
}

/** Whether a provider is enabled (default: true) */
export function getProviderEnabled(
  providerId: string,
  enabledByDefault = true,
): boolean {
  return getConfig().get<boolean>(`${providerId}.enabled`, enabledByDefault);
}

/** Base URL for a provider, falling back to its default */
export function getProviderBaseUrl(
  providerId: string,
  defaultBaseUrl: string,
): string {
  return getConfig().get<string>(`${providerId}.baseUrl`) || defaultBaseUrl;
}

/** Failover mapping: primary model ID → fallback model ID */
export function getFailoverModels(): Record<string, string> {
  return getConfig().get<Record<string, string>>(SETTING_FAILOVER_MODELS, {});
}

/** Routing strategy: failover or latency */
export function getRoutingStrategy(): RoutingStrategy {
  return getConfig().get<RoutingStrategy>(SETTING_ROUTING_STRATEGY, "failover");
}

/**
 * Setting that controls status bar visibility.
 *
 * Owned here rather than by the status bar so every settings key is read
 * through this module, which is what keeps the keys and their defaults in one
 * place.
 */
export const SHOW_STATUS_BAR_SETTING = SETTING_SHOW_STATUS_BAR;

/** Whether the token-usage status bar item should be shown (default: true) */
export function getShowStatusBar(): boolean {
  return getConfig().get<boolean>(SETTING_SHOW_STATUS_BAR, true);
}
