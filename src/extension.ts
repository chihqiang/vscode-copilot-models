/**
 * VS Code Copilot Models 扩展主入口
 *
 * 支持多种语言模型接入 VS Code Copilot Chat
 * 使用动态注册机制，支持扩展新的模型提供者
 */

import vscode from 'vscode';
import { initLogger, logger } from './core';
import type { IChatProvider } from './core/interfaces';
import { ProviderFactoryRegistry, type IProviderFactory } from './core/provider-registry';
import { ModelRegistry } from './core/registry';
import { registerAllProviders } from './providers';

/**
 * 已激活的 Chat Provider 实例 (用于停用时清理)
 */
const chatProviders: Map<string, IChatProvider> = new Map();

/**
 * 已注册的 Provider 注册 Disposables (用于动态启停)
 */
const registrationDisposables: Map<string, vscode.Disposable> = new Map();

/**
 * 选择提供者 (用于命令中提取重复逻辑)
 * @param factories 提供者工厂列表
 * @returns 选中的提供者工厂，或 undefined 表示取消选择
 */
async function selectProvider(factories: IProviderFactory[]): Promise<IProviderFactory | undefined> {
	if (factories.length === 0) {
		vscode.window.showWarningMessage('No model providers enabled');
		return undefined;
	}

	// 如果只有一个提供商，直接返回
	if (factories.length === 1) {
		return factories[0];
	}

	// 多个提供商时，让用户选择
	const selected = await vscode.window.showQuickPick(
		factories.map((f) => ({ label: f.providerName, id: f.providerId })),
		{ placeHolder: 'Select a model provider' },
	);

	if (!selected) {
		return undefined;
	}

	return factories.find((f) => f.providerId === selected.id);
}

/**
 * 扩展激活入口
 */
export async function activate(context: vscode.ExtensionContext): Promise<void> {
	logger.core.info(`Activating extension: ${context.extension.packageJSON.displayName} v${context.extension.packageJSON.version}`);
	try {
		initLogger(context);
		// 注册所有内置提供者
		registerAllProviders();
		// 获取所有已启用的提供者并注册
		const factories = ProviderFactoryRegistry.getInstance().getEnabledFactories();
		logger.core.info(`Found ${factories.length} enabled provider(s)`);

		for (const factory of factories) {
			registerProvider(factory, context);
		}

		// 注册通用命令
		registerCommands();

		// 监听配置变化，动态启停 Provider
		context.subscriptions.push(
			vscode.workspace.onDidChangeConfiguration((e) => {
				if (!e.affectsConfiguration('copilot-models')) {
					return;
				}

				const allFactories = ProviderFactoryRegistry.getInstance().getAllFactories();
				for (const factory of allFactories) {
					const isNowEnabled = factory.isEnabled();
					const isCurrentlyRegistered = registrationDisposables.has(factory.providerId);

					if (isNowEnabled && !isCurrentlyRegistered) {
						logger.core.info(`Config changed: enabling provider "${factory.providerId}"`);
						registerProvider(factory, context);
					} else if (!isNowEnabled && isCurrentlyRegistered) {
						logger.core.info(`Config changed: disabling provider "${factory.providerId}"`);
						unregisterProvider(factory.providerId);
					}
				}
			}),
		);

		logger.core.info(`Extension activated successfully with ${factories.length} provider(s): ${factories.map((f) => f.providerId).join(', ')}`);
		logger.show(); // 自动显示日志面板
	} catch (error) {
		logger.core.error('Failed to activate extension:', error);
		throw error;
	}
}

/**
 * 注册单个提供者
 */
function registerProvider(factory: IProviderFactory, context: vscode.ExtensionContext): void {
	const { providerId, providerName } = factory;

	logger.core.info(`Registering provider: ${providerName} (${providerId})...`);

	try {
		// 创建 Chat Provider 并注册到 VS Code
		const chatProvider = factory.createChatProvider(context);
		const disposable = vscode.lm.registerLanguageModelChatProvider(providerId, chatProvider);
		context.subscriptions.push(disposable);
		registrationDisposables.set(providerId, disposable);
		chatProviders.set(providerId, chatProvider);

		logger.core.info(`${providerName} provider registered successfully`);
	} catch (error) {
		logger.core.error(`Failed to register provider "${providerId}":`, error);
	}
}

/**
 * 注销单个提供者
 */
function unregisterProvider(providerId: string): void {
	const disposable = registrationDisposables.get(providerId);
	if (disposable) {
		disposable.dispose();
		registrationDisposables.delete(providerId);
	}

	const provider = chatProviders.get(providerId);
	if (provider) {
		provider.dispose();
		chatProviders.delete(providerId);
	}

	logger.core.info(`Provider "${providerId}" unregistered`);
}

/**
 * 注册通用命令
 */
function registerCommands(): void {
	// 设置 API 密钥（先选择服务商，再输入 token）
	vscode.commands.registerCommand('copilot-models.setApiKey', async () => {
		const factories = ProviderFactoryRegistry.getInstance().getEnabledFactories();
		const factory = await selectProvider(factories);

		if (factory) {
			const provider = chatProviders.get(factory.providerId);
			await provider?.configureApiKey();
		}
	});

	// 清除 API 密钥（先选择服务商）
	vscode.commands.registerCommand('copilot-models.clearApiKey', async () => {
		const factories = ProviderFactoryRegistry.getInstance().getEnabledFactories();
		const factory = await selectProvider(factories);

		if (factory) {
			const provider = chatProviders.get(factory.providerId);
			await provider?.clearApiKey();
		}
	});

	// 打开设置
	vscode.commands.registerCommand('copilot-models.openSettings', () => {
		logger.core.info('openSettings command invoked');
		vscode.commands.executeCommand('workbench.action.openSettings', 'copilot-models');
	});

	// 显示日志
	vscode.commands.registerCommand('copilot-models.showLog', () => {
		logger.core.info('showLog command invoked');
		logger.show();
	});

	// 清除日志
	vscode.commands.registerCommand('copilot-models.clearLog', () => {
		logger.core.info('clearLog command invoked');
		logger.clear();
	});

	// 刷新模型
	vscode.commands.registerCommand('copilot-models.refreshModels', async () => {
		logger.core.info('refreshModels command invoked');
		// 触发所有已注册 provider 的模型选择器刷新
		for (const provider of chatProviders.values()) {
			provider.refreshModelPicker();
		}
		logger.core.info('Models refreshed successfully');
	});
}

/**
 * 扩展停用入口
 */
export async function deactivate(): Promise<void> {
	logger.core.info('Deactivating extension...');

	// 停用所有 Chat Provider
	for (const [providerId, provider] of chatProviders) {
		try {
			await provider.prepareForDeactivate();
			provider.dispose();
			logger.core.info(`Provider "${providerId}" deactivated`);
		} catch (error) {
			logger.core.error(`Failed to deactivate provider "${providerId}":`, error);
		}
	}
	chatProviders.clear();

	// 清空注册表
	ModelRegistry.getInstance().clear();
	ProviderFactoryRegistry.getInstance().clear();

	logger.core.info('Extension deactivated');
	logger.dispose();
}
