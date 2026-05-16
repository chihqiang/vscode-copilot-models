/**
 * VS Code Copilot Models 扩展主入口
 *
 * 支持多种语言模型接入 VS Code Copilot Chat
 * 使用动态注册机制，支持扩展新的模型提供者
 */

import vscode from 'vscode';
import { logger } from './core';
import { ProviderFactoryRegistry, type IProviderFactory } from './core/provider-registry';
import { ModelRegistry } from './core/registry';
import { registerAllProviders } from './providers';

/**
 * 已激活的 Chat Provider 实例 (用于停用时清理)
 */
const chatProviders: Map<string, vscode.LanguageModelChatProvider> = new Map();

/**
 * 扩展激活入口
 */
export async function activate(context: vscode.ExtensionContext): Promise<void> {
	logger.core.info(`Activating extension: ${context.extension.packageJSON.displayName} v${context.extension.packageJSON.version}`);
	logger.core.info(`Extension path: ${context.extension.extensionPath}`);

	try {
		// 注册所有内置提供者
		logger.core.info('Registering built-in providers...');
		registerAllProviders();

		// 获取所有已启用的提供者并注册
		const factories = ProviderFactoryRegistry.getInstance().getEnabledFactories();
		logger.core.info(`Found ${factories.length} enabled provider(s)`);

		for (const factory of factories) {
			registerProvider(factory, context);
		}

		// 注册通用命令
		registerCommands();

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
		chatProviders.set(providerId, chatProvider);

		logger.core.info(`${providerName} provider registered successfully`);
	} catch (error) {
		logger.core.error(`Failed to register provider "${providerId}":`, error);
	}
}

/**
 * 注册通用命令
 */
function registerCommands(): void {
	logger.core.info('Registering commands...');

	// 设置 API 密钥（先选择服务商，再输入 token）
	vscode.commands.registerCommand('copilot-models.setApiKey', async () => {
		const factories = ProviderFactoryRegistry.getInstance().getEnabledFactories();

		if (factories.length === 0) {
			vscode.window.showWarningMessage('No model providers enabled');
			return;
		}

		// 如果只有一个提供商，直接设置
		if (factories.length === 1) {
			const factory = factories[0];
			const provider = chatProviders.get(factory.providerId);
			if (provider) {
				const chatProvider = provider as { configureApiKey?(): Promise<void> };
				await chatProvider.configureApiKey?.();
			}
			return;
		}

		// 多个提供商时，先选择
		const selected = await vscode.window.showQuickPick(
			factories.map((f) => ({ label: f.providerName, id: f.providerId })),
			{ placeHolder: 'Select a model provider' },
		);

		if (!selected) {
			return;
		}

		const provider = chatProviders.get(selected.id);
		if (provider) {
			const chatProvider = provider as { configureApiKey?(): Promise<void> };
			await chatProvider.configureApiKey?.();
		}
	});

	// 清除 API 密钥（先选择服务商）
	vscode.commands.registerCommand('copilot-models.clearApiKey', async () => {
		const factories = ProviderFactoryRegistry.getInstance().getEnabledFactories();

		if (factories.length === 0) {
			vscode.window.showWarningMessage('No model providers enabled');
			return;
		}

		if (factories.length === 1) {
			const factory = factories[0];
			const provider = chatProviders.get(factory.providerId);
			if (provider) {
				const chatProvider = provider as { clearApiKey?(): Promise<void> };
				await chatProvider.clearApiKey?.();
			}
			return;
		}

		const selected = await vscode.window.showQuickPick(
			factories.map((f) => ({ label: f.providerName, id: f.providerId })),
			{ placeHolder: 'Select a model provider' },
		);

		if (!selected) {
			return;
		}

		const provider = chatProviders.get(selected.id);
		if (provider) {
			const chatProvider = provider as { clearApiKey?(): Promise<void> };
			await chatProvider.clearApiKey?.();
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
		for (const [, provider] of chatProviders) {
			const chatProvider = provider as { refreshModelPicker?(): void };
			chatProvider.refreshModelPicker?.();
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
			const chatProvider = provider as { prepareForDeactivate?(): Promise<void>; dispose?(): void };
			await chatProvider.prepareForDeactivate?.();
			chatProvider.dispose?.();
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
