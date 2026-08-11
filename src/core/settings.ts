/**
 * Centralized settings access for the `copilot-models` configuration section.
 *
 * All core modules read configuration through this facade instead of
 * repeating `vscode.workspace.getConfiguration(CONFIG_SECTION)` boilerplate,
 * so configuration keys and their defaults live in one place.
 */
import vscode from "vscode";
import { CONFIG_SECTION, type RoutingStrategy } from "./models";

/** Get the copilot-models WorkspaceConfiguration */
export function getConfig(): vscode.WorkspaceConfiguration {
  return vscode.workspace.getConfiguration(CONFIG_SECTION);
}

/** API request timeout in milliseconds (default: 60000) */
export function getTimeoutMs(): number {
  return getConfig().get<number>("timeoutMs") ?? 60_000;
}

/** Maximum number of API request retries (default: 1) */
export function getMaxRetries(): number {
  return getConfig().get<number>("maxRetries") ?? 1;
}

/** Log verbosity: minimal / metadata / verbose */
export function getDebugMode(): string | undefined {
  return getConfig().get<string>("debugMode");
}

/** Maximum image upload size in bytes (default: 20MB, 0 = disabled) */
export function getMaxImageSize(): number {
  return getConfig().get<number>("maxImageSize") ?? 20 * 1024 * 1024;
}

/** Override map: model ID → custom API model name */
export function getModelIdOverrides(): Record<string, string> {
  return getConfig().get<Record<string, string>>("modelIdOverrides", {});
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
  return getConfig().get<Record<string, string>>("failoverModels", {});
}

/** Routing strategy: failover or latency */
export function getRoutingStrategy(): RoutingStrategy {
  return getConfig().get<RoutingStrategy>("routingStrategy", "failover");
}
