/**
 * VS Code Copilot Models 扩展主入口
 *
 * 支持多种语言模型接入 VS Code Copilot Chat
 * 当前支持: DeepSeek
 */

import vscode from 'vscode';
import { logger } from './core';
import { registerDeepSeekProvider, DeepSeekChatProvider } from './providers/deepseek';

/**
 * 已激活的提供商
 */
let deepseekProvider: DeepSeekChatProvider | undefined;

/**
 * 扩展激活入口
 */
export async function activate(context: vscode.ExtensionContext): Promise<void> {
	logger.core.info(`Activating extension: ${context.extension.packageJSON.displayName} v${context.extension.packageJSON.version}`);
	logger.core.info(`Extension path: ${context.extension.extensionPath}`);

	try {
		// 注册 DeepSeek 提供者
		logger.core.info('Registering DeepSeek provider...');
		deepseekProvider = registerDeepSeekProvider(context);
		logger.core.info('DeepSeek provider registered successfully');

		// 注册语言模型提供者
		logger.core.info('Registering language model chat provider...');
		context.subscriptions.push(
			vscode.lm.registerLanguageModelChatProvider('deepseek', deepseekProvider),
		);

		// 注册命令
		logger.core.info('Registering commands...');
		context.subscriptions.push(
			vscode.commands.registerCommand('copilot-models.setApiKey', async (vendor?: string) => {
				const vendorId = vendor || 'deepseek';
				logger.core.info(`setApiKey command invoked for vendor: ${vendorId}`);
				if (vendorId === 'deepseek' && deepseekProvider) {
					await deepseekProvider.configureApiKey();
				}
			}),
			vscode.commands.registerCommand('copilot-models.clearApiKey', async (vendor?: string) => {
				const vendorId = vendor || 'deepseek';
				logger.core.info(`clearApiKey command invoked for vendor: ${vendorId}`);
				if (vendorId === 'deepseek' && deepseekProvider) {
					await deepseekProvider.clearApiKey();
				}
			}),
			vscode.commands.registerCommand('copilot-models.openSettings', () => {
				logger.core.info('openSettings command invoked');
				vscode.commands.executeCommand('workbench.action.openSettings', 'copilot-models');
			}),
			vscode.commands.registerCommand('copilot-models.showLog', () => {
				logger.core.info('showLog command invoked');
				logger.show();
			}),
			vscode.commands.registerCommand('copilot-models.clearLog', () => {
				logger.core.info('clearLog command invoked');
				logger.clear();
			}),
		);

		// 注册清理命令
		context.subscriptions.push(
			vscode.commands.registerCommand('copilot-models.refreshModels', async () => {
				logger.core.info('refreshModels command invoked');
				if (deepseekProvider) {
					await deepseekProvider.refreshModels();
					logger.core.info('Models refreshed successfully');
				}
			}),
		);

		// 注册扩展停用时清理日志
		context.subscriptions.push({
			dispose: () => {
				logger.core.info('Extension disposing...');
			},
		});

		// 刷新模型选择器
		logger.core.info('Refreshing model picker...');
		deepseekProvider.refreshModelPicker();

		logger.core.info('Extension activated successfully with DeepSeek provider');
		logger.show(); // 自动显示日志面板
	} catch (error) {
		logger.core.error('Failed to activate extension:', error);
		throw error;
	}
}

/**
 * 扩展停用入口
 */
export async function deactivate(): Promise<void> {
	logger.core.info('Deactivating extension...');

	if (deepseekProvider) {
		try {
			await deepseekProvider.prepareForDeactivate();
			deepseekProvider.dispose();
			logger.core.info('DeepSeek provider deactivated');
		} catch (error) {
			logger.core.error('Failed to deactivate DeepSeek provider:', error);
		}
		deepseekProvider = undefined;
	}

	logger.core.info('Extension deactivated');
	logger.dispose();
}
