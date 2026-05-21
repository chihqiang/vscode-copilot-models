/**
 * Provider 加载器
 *
 * 三层发现机制：
 * 1. 内置 provider（编译时注册）
 * 2. 用户配置（copilot-models.customProviders）
 * 3. 工作区 .vscode/copilot-models/providers/ 目录
 */

import vscode from 'vscode';
import { IProviderFactory, ProviderFactoryRegistry } from './provider-registry';
import { CONFIG_SECTION, ModelDefinition } from './models';
import { createApiClient, ClientOptions } from './client';
import { createGenericProviderFactory } from './provider-factory';
import { logger } from './logger';

/** 自定义 provider 的模型定义 */
export interface CustomProviderModel {
  id: string;
  name?: string;
  maxInputTokens?: number;
  maxOutputTokens?: number;
  toolCalling?: boolean;
  imageInput?: boolean;
  thinking?: boolean;
}

/** 自定义 provider 配置项 */
export interface CustomProviderEntry {
  providerId: string;
  providerName: string;
  baseUrl: string;
  apiKeyPrompt?: string;
  apiKeyPlaceholder?: string;
  models?: CustomProviderModel[];
  thinkingParamType?: 'reasoning_effort' | 'thinking_enabled' | 'none';
}

/** 将自定义 provider 的模型配置转为内部 ModelDefinition */
function toModelDefinitions(entry: CustomProviderEntry): ModelDefinition[] {
  const defaults: CustomProviderModel[] = [{ id: 'default' }];
  return (entry.models ?? defaults).map((m) => ({
    id: m.id,
    name: m.name ?? m.id,
    family: entry.providerId,
    version: '1.0',
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

/** 根据自定义 provider 配置创建工厂 */
function createCustomProviderFactory(entry: CustomProviderEntry): IProviderFactory {
  const models = toModelDefinitions(entry);
  const { providerId, providerName, baseUrl, apiKeyPrompt, apiKeyPlaceholder, thinkingParamType = 'reasoning_effort' } = entry;

  const convertThinkingParams = thinkingParamType === 'thinking_enabled'
    ? (request: any, effort: string) => { request.thinking = { type: effort === 'none' ? 'disabled' : 'enabled' }; }
    : thinkingParamType === 'reasoning_effort'
      ? (request: any, effort: string) => { if (effort !== 'none') { request.reasoning_effort = effort; } }
      : undefined;

  return createGenericProviderFactory({
    providerId,
    providerName,
    defaultBaseUrl: baseUrl,
    models,
    apiKeyPrompt: apiKeyPrompt ?? `Enter your ${providerName} API Key`,
    apiKeyPlaceholder: apiKeyPlaceholder ?? 'your-api-key-here',
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

/** 从 VS Code 配置中读取自定义 provider */
function discoverCustomProvidersFromConfig(): IProviderFactory[] {
  const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
  const customProviders = config.get<CustomProviderEntry[] | Record<string, CustomProviderEntry>>('customProviders', []);

  const entries: CustomProviderEntry[] = Array.isArray(customProviders)
    ? customProviders
    : Object.values(customProviders);

  return entries
    .filter((e) => e.providerId && e.providerName)
    .map((entry) => {
      logger.provider.info(`Loading custom provider: ${entry.providerName} (${entry.providerId})`);
      return createCustomProviderFactory(entry);
    });
}

/** 扫描工作区目录下的 provider 配置 */
async function scanWorkspaceProviders(_context: vscode.ExtensionContext): Promise<IProviderFactory[]> {
  const factories: IProviderFactory[] = [];

  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders) { return factories; }

  for (const folder of workspaceFolders) {
    try {
      const providerDir = vscode.Uri.joinPath(folder.uri, '.vscode', 'copilot-models', 'providers');
      let entries: [string, vscode.FileType][];
      try {
        entries = await vscode.workspace.fs.readDirectory(providerDir);
      } catch {
        continue;
      }

      for (const [name, type] of entries) {
        if (type !== vscode.FileType.Directory) { continue; }

        const manifestUri = vscode.Uri.joinPath(providerDir, name, 'provider.json');
        try {
          const content = await vscode.workspace.fs.readFile(manifestUri);
          const manifest: CustomProviderEntry = JSON.parse(new TextDecoder().decode(content));
          manifest.providerId = manifest.providerId || name;

          if (ProviderFactoryRegistry.getInstance().has(manifest.providerId)) {
            logger.provider.warn(`Workspace provider "${manifest.providerId}" conflicts, skipping`);
            continue;
          }

          factories.push(createCustomProviderFactory(manifest));
          logger.provider.info(`Discovered workspace provider: ${manifest.providerName} (${manifest.providerId})`);
        } catch (e) {
          logger.provider.debug(`No valid provider.json in workspace providers/${name}`, e);
        }
      }
    } catch (error) {
      logger.provider.warn(`Error scanning workspace provider folder "${folder.uri}":`, error);
    }
  }

  return factories;
}

/** 执行完整的 provider 发现流程 */
export async function discoverAllProviders(builtInFactories: IProviderFactory[], context: vscode.ExtensionContext): Promise<void> {
  const registry = ProviderFactoryRegistry.getInstance();

  for (const factory of builtInFactories) {
    if (!registry.has(factory.providerId)) {
      registry.register(factory);
      logger.provider.debug(`Registered built-in provider: ${factory.providerName}`);
    }
  }

  const custom = discoverCustomProvidersFromConfig();
  for (const factory of custom) {
    if (!registry.has(factory.providerId)) {
      registry.register(factory);
      logger.provider.info(`Registered custom provider: ${factory.providerName}`);
    }
  }

  const workspace = await scanWorkspaceProviders(context);
  for (const factory of workspace) {
    if (!registry.has(factory.providerId)) {
      registry.register(factory);
      logger.provider.info(`Registered workspace provider: ${factory.providerName}`);
    }
  }

  logger.provider.info(`Discovery complete: ${builtInFactories.length} built-in, ${custom.length} custom, ${workspace.length} workspace`);
}
