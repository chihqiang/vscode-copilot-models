/**
 * VS Code Copilot Models 扩展主入口
 *
 * 支持多种语言模型接入 VS Code Copilot Chat
 * 使用 ModelRouter 统一路由，支持故障转移和延迟跟踪
 */

import vscode from 'vscode';
import { applyLogLevelFromConfig, discoverAllProviders, IChatProvider, initLogger, IProviderFactory, logger, ModelRegistry, ModelRouter, ProviderFactoryRegistry } from './core';
import { getBuiltInProviderFactories } from './providers';

/**
 * 模型路由器实例（统一管理所有 provider）
 */
let modelRouter: ModelRouter | undefined;

/**
 * 已注册的 Provider 注册 Disposable（用于动态启停）
 */
const registrationDisposables: Map<string, vscode.Disposable> = new Map();

/**
 * 选择提供者（用于命令中提取重复逻辑）
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
 * 向路由器和 VS Code 注册单个提供者
 */
function registerProvider(factory: IProviderFactory, context: vscode.ExtensionContext): IChatProvider {
	const { providerId, providerName } = factory;

	logger.core.debug(`Creating provider: ${providerName} (${providerId})...`);

	const chatProvider = factory.createChatProvider(context);
	const registry = ModelRegistry.getInstance();
	const modelProvider = registry.getProvider(providerId);
	const models = modelProvider?.getModels().map((m) => m.id) ?? [];

	if (modelRouter) {
		modelRouter.addProvider(providerId, chatProvider, models);
	} else {
		const disposable = vscode.lm.registerLanguageModelChatProvider(providerId, chatProvider);
		context.subscriptions.push(disposable);
		registrationDisposables.set(providerId, disposable);
	}

	logger.core.debug(`${providerName} provider registered successfully`);
	return chatProvider;
}

/**
 * 从路由器和 VS Code 注销单个提供者
 */
async function unregisterProvider(providerId: string): Promise<void> {
	modelRouter?.removeProvider(providerId);

	const disposable = registrationDisposables.get(providerId);
	if (disposable) {
		disposable.dispose();
		registrationDisposables.delete(providerId);
	}

	ModelRegistry.getInstance().unregisterProvider(providerId);
	logger.core.debug(`Provider "${providerId}" unregistered`);
}

/**
 * 扩展激活入口
 */
export async function activate(context: vscode.ExtensionContext): Promise<void> {
	try {
		initLogger(context);
		logger.core.info(`Activating extension: ${context.extension.packageJSON.displayName} v${context.extension.packageJSON.version}`);
		// 通过 provider-loader 发现所有提供者（内置 + 自定义 + 工作区）
		await discoverAllProviders(getBuiltInProviderFactories(), context);
		// 获取所有已启用的提供者并注册
		const factories = ProviderFactoryRegistry.getInstance().getEnabledFactories();
		logger.core.info(`Found ${factories.length} enabled provider(s)`);

		modelRouter = new ModelRouter();
		for (const factory of factories) {
			registerProvider(factory, context);
		}

		const routerDisposable = vscode.lm.registerLanguageModelChatProvider('copilot-models-router', modelRouter);
		context.subscriptions.push(routerDisposable);
		registrationDisposables.set('copilot-models-router', routerDisposable);

		// 注册通用命令
		registerCommands();

		// 监听配置变化，动态启停 Provider 及更新日志级别
		context.subscriptions.push(
			vscode.workspace.onDidChangeConfiguration(async (e) => {
				if (!e.affectsConfiguration('copilot-models')) {
					return;
				}

				if (e.affectsConfiguration('copilot-models.debugMode')) {
					applyLogLevelFromConfig();
					logger.core.info(`Log level updated to: ${logger.level}`);
				}

				const allFactories = ProviderFactoryRegistry.getInstance().getAllFactories();
				let routerChanged = false;

				for (const factory of allFactories) {
					const isNowEnabled = factory.isEnabled();
					const isCurrentlyRegistered = modelRouter?.hasProvider(factory.providerId) ?? false;

					if (isNowEnabled && !isCurrentlyRegistered) {
						logger.core.info(`Config changed: enabling provider "${factory.providerId}"`);
						registerProvider(factory, context);
						routerChanged = true;
					} else if (!isNowEnabled && isCurrentlyRegistered) {
						logger.core.info(`Config changed: disabling provider "${factory.providerId}"`);
						await unregisterProvider(factory.providerId);
						routerChanged = true;
					}
				}

				if (routerChanged && modelRouter) {
					modelRouter.refreshModelPicker();
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
 * 注册通用命令
 */
function registerCommands(): void {
	// 设置 API 密钥（通过路由器管理）
	vscode.commands.registerCommand('copilot-models.setApiKey', async () => {
		if (modelRouter) {
			await modelRouter.configureApiKey();
		}
	});

	// 清除 API 密钥
	vscode.commands.registerCommand('copilot-models.clearApiKey', async () => {
		if (modelRouter) {
			await modelRouter.clearApiKey();
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
		modelRouter?.refreshModelPicker();
		logger.core.info('Models refreshed successfully');
	});

	// 显示路由统计
	vscode.commands.registerCommand('copilot-models.showLatencyStats', () => {
		if (!modelRouter) {return;}
		const stats = modelRouter.latencyTracker.getAllStats();
		if (stats.size === 0) {
			vscode.window.showInformationMessage('No latency data available');
			return;
		}
		const lines = Array.from(stats.entries()).map(([id, s]) =>
			`${id}: avg=${s.averageMs.toFixed(0)}ms, min=${s.minMs}ms, max=${s.maxMs}ms (${s.count} samples)`,
		);
		vscode.window.showInformationMessage('Latency stats:\n' + lines.join('\n'), { modal: true });
	});
}

/**
 * 扩展停用入口
 */
export async function deactivate(): Promise<void> {
	logger.core.info('Deactivating extension...');

	if (modelRouter) {
		await modelRouter.prepareForDeactivate();
		modelRouter.dispose();
		modelRouter = undefined;
	}

	for (const [providerId, disposable] of registrationDisposables) {
		try {
			disposable.dispose();
			logger.core.info(`Disposable "${providerId}" disposed`);
		} catch (error) {
			logger.core.error(`Failed to dispose "${providerId}":`, error);
		}
	}
	registrationDisposables.clear();

	// 清空注册表
	ModelRegistry.getInstance().clear();
	ProviderFactoryRegistry.getInstance().clear();

	logger.core.info('Extension deactivated');
	logger.dispose();
}
