/**
 * Provider Loader
 *
 * Three-layer discovery mechanism:
 * 1. Built-in providers (compile-time registration)
 * 2. User configuration (copilot-models.customProviders)
 * 3. Workspace .vscode/copilot-models/providers/ directory
 */

import vscode from "vscode";
import { IProviderFactory, Registry } from "./registry";
import { CONFIG_SECTION, ModelDefinition } from "./models";
import { createApiClient, ClientOptions } from "./client";
import { createGenericProviderFactory } from "./provider-factory";
import { logger } from "./logger";

/** Custom provider model definition */
export interface CustomProviderModel {
  id: string;
  name?: string;
  maxInputTokens?: number;
  maxOutputTokens?: number;
  toolCalling?: boolean;
  imageInput?: boolean;
  thinking?: boolean;
}

/** Custom provider configuration entry */
export interface CustomProviderEntry {
  providerId: string;
  providerName: string;
  baseUrl: string;
  apiKeyPrompt?: string;
  apiKeyPlaceholder?: string;
  models?: CustomProviderModel[];
  thinkingParamType?: "reasoning_effort" | "thinking_enabled" | "none";
}

/** Convert custom provider model config to internal ModelDefinition */
function toModelDefinitions(entry: CustomProviderEntry): ModelDefinition[] {
  const defaults: CustomProviderModel[] = [{ id: "default" }];
  return (entry.models ?? defaults).map((m) => ({
    id: m.id,
    name: m.name ?? m.id,
    family: entry.providerId,
    version: "1.0",
    detail: `Custom provider: ${entry.providerName}`,
    maxInputTokens: m.maxInputTokens ?? 128000,
    maxOutputTokens: m.maxOutputTokens ?? 4096,
    capabilities: {
      toolCalling: m.toolCalling ?? false,
      imageInput: m.imageInput ?? false,
      thinking: m.thinking ?? false,
    },
  }));
}

/** Create factory from custom provider configuration */
function createCustomProviderFactory(
  entry: CustomProviderEntry,
): IProviderFactory {
  const models = toModelDefinitions(entry);
  const {
    providerId,
    providerName,
    baseUrl,
    apiKeyPrompt,
    apiKeyPlaceholder,
    thinkingParamType = "reasoning_effort",
  } = entry;

  const convertThinkingParams =
    thinkingParamType === "thinking_enabled"
      ? (request: any, effort: string) => {
          request.thinking = {
            type: effort === "none" ? "disabled" : "enabled",
          };
        }
      : thinkingParamType === "reasoning_effort"
        ? (request: any, effort: string) => {
            if (effort !== "none") {
              request.reasoning_effort = effort;
            }
          }
        : undefined;

  return createGenericProviderFactory({
    providerId,
    providerName,
    defaultBaseUrl: baseUrl,
    models,
    apiKeyPrompt: apiKeyPrompt ?? `Enter your ${providerName} API Key`,
    apiKeyPlaceholder: apiKeyPlaceholder ?? "your-api-key-here",
    configSection: CONFIG_SECTION,
    createClient: (url: string, key: string, options?: ClientOptions) =>
      createApiClient({
        baseUrl: url,
        apiKey: key,
        providerName,
        timeoutMs: options?.timeoutMs ?? 60_000,
        maxRetries: options?.maxRetries ?? 1,
      }),
    ...(convertThinkingParams ? { convertThinkingParams } : {}),
  }).factory;
}

/** Read custom providers from VS Code configuration */
function discoverCustomProvidersFromConfig(): IProviderFactory[] {
  const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
  const entries = config.get<CustomProviderEntry[]>("customProviders", []);

  return entries
    .filter((e) => e.providerId && e.providerName)
    .map((entry) => {
      logger.provider.info(
        `Loading custom provider: ${entry.providerName} (${entry.providerId})`,
      );
      return createCustomProviderFactory(entry);
    });
}

/** Scan workspace directory for provider configurations */
async function scanWorkspaceProviders(): Promise<IProviderFactory[]> {
  const factories: IProviderFactory[] = [];

  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders) {
    return factories;
  }

  for (const folder of workspaceFolders) {
    try {
      const providerDir = vscode.Uri.joinPath(
        folder.uri,
        ".vscode",
        "copilot-models",
        "providers",
      );
      let entries: [string, vscode.FileType][];
      try {
        entries = await vscode.workspace.fs.readDirectory(providerDir);
      } catch {
        continue;
      }

      for (const [name, type] of entries) {
        if (type !== vscode.FileType.Directory) {
          continue;
        }

        const manifestUri = vscode.Uri.joinPath(
          providerDir,
          name,
          "provider.json",
        );
        try {
          const content = await vscode.workspace.fs.readFile(manifestUri);
          const manifest: CustomProviderEntry = JSON.parse(
            new TextDecoder().decode(content),
          );
          manifest.providerId = manifest.providerId || name;

          if (Registry.getInstance().hasFactory(manifest.providerId)) {
            logger.provider.warn(
              `Workspace provider "${manifest.providerId}" conflicts, skipping`,
            );
            continue;
          }

          factories.push(createCustomProviderFactory(manifest));
          logger.provider.info(
            `Discovered workspace provider: ${manifest.providerName} (${manifest.providerId})`,
          );
        } catch (e) {
          logger.provider.debug(
            `No valid provider.json in workspace providers/${name}`,
            e,
          );
        }
      }
    } catch (error) {
      logger.provider.warn(
        `Error scanning workspace provider folder "${folder.uri}":`,
        error,
      );
    }
  }

  return factories;
}

/** Execute complete provider discovery process */
export async function discoverAllProviders(
  builtInFactories: IProviderFactory[],
  _context: vscode.ExtensionContext,
): Promise<void> {
  const registry = Registry.getInstance();

  for (const factory of builtInFactories) {
    if (!registry.hasFactory(factory.providerId)) {
      registry.registerFactory(factory);
      logger.provider.debug(
        `Registered built-in provider: ${factory.providerName}`,
      );
    }
  }

  const custom = discoverCustomProvidersFromConfig();
  for (const factory of custom) {
    if (!registry.hasFactory(factory.providerId)) {
      registry.registerFactory(factory);
      logger.provider.info(
        `Registered custom provider: ${factory.providerName}`,
      );
    }
  }

  const workspace = await scanWorkspaceProviders();
  for (const factory of workspace) {
    if (!registry.hasFactory(factory.providerId)) {
      registry.registerFactory(factory);
      logger.provider.info(
        `Registered workspace provider: ${factory.providerName}`,
      );
    }
  }

  logger.provider.info(
    `Discovery complete: ${builtInFactories.length} built-in, ${custom.length} custom, ${workspace.length} workspace`,
  );
}
