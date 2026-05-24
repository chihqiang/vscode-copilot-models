/**
 * VS Code Copilot Models extension main entry
 *
 * Supports multiple language models for VS Code Copilot Chat
 * Uses ModelRouter for unified routing with failover and latency tracking
 */

import vscode from 'vscode';
import { applyLogLevelFromConfig, discoverAllProviders, IChatProvider, initLogger, IProviderFactory, logger, ModelRegistry, ModelRouter, ProviderFactoryRegistry } from './core';
import { getBuiltInProviderFactories } from './providers';

/**
 * Model router instance (unified management of all providers)
 */
let modelRouter: ModelRouter | undefined;

/**
 * Registered provider registration disposables (for dynamic enable/disable)
 */
const registrationDisposables: Map<string, vscode.Disposable> = new Map();

/**
 * Select provider (extracts common logic for commands)
 * @param factories provider factory list
 * @returns selected provider factory, or undefined if cancelled
 */
async function selectProvider(factories: IProviderFactory[]): Promise<IProviderFactory | undefined> {
	if (factories.length === 0) {
		vscode.window.showWarningMessage('No model providers enabled');
		return undefined;
	}

	// If only one provider, return directly
	if (factories.length === 1) {
		return factories[0];
	}

	// Multiple providers, let user choose
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
 * Register a single provider to router and VS Code
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
 * Unregister a single provider from router and VS Code
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
 * Extension activation entry
 */
export async function activate(context: vscode.ExtensionContext): Promise<void> {
	try {
		initLogger(context);
		logger.core.info(`Activating extension`, {
			name: context.extension.packageJSON.displayName,
			version: context.extension.packageJSON.version,
			extensionKind: context.extension.extensionKind,
			vscode: vscode.version,
			uiKind: vscode.env.uiKind,
			platform: process.platform,
			arch: process.arch
		});
		// Discover all providers via provider-loader (built-in + custom + workspace)
		await discoverAllProviders(getBuiltInProviderFactories(), context);
		// Get all enabled providers and register them
		const factories = ProviderFactoryRegistry.getInstance().getEnabledFactories();
		logger.core.info(`Found ${factories.length} enabled provider(s)`);

		modelRouter = new ModelRouter();
		for (const factory of factories) {
			registerProvider(factory, context);
		}

		const routerDisposable = vscode.lm.registerLanguageModelChatProvider('copilot-models-router', modelRouter);
		context.subscriptions.push(routerDisposable);
		registrationDisposables.set('copilot-models-router', routerDisposable);

		// Register common commands
		registerCommands();

		// Listen for config changes, dynamically enable/disable providers and update log level
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
		logger.show(); // Auto-show log panel
	} catch (error) {
		logger.core.error('Failed to activate extension:', error);
		throw error;
	}
}

/**
 * Register common commands
 */
function registerCommands(): void {
	// Set API key (managed via router)
	vscode.commands.registerCommand('copilot-models.setApiKey', async () => {
		if (modelRouter) {
			await modelRouter.configureApiKey();
		}
	});

	// Clear API key
	vscode.commands.registerCommand('copilot-models.clearApiKey', async () => {
		if (modelRouter) {
			await modelRouter.clearApiKey();
		}
	});

	// Open settings
	vscode.commands.registerCommand('copilot-models.openSettings', () => {
		logger.core.info('openSettings command invoked');
		vscode.commands.executeCommand('workbench.action.openSettings', 'copilot-models');
	});

	// Show log
	vscode.commands.registerCommand('copilot-models.showLog', () => {
		logger.core.info('showLog command invoked');
		logger.show();
	});

	// Clear log
	vscode.commands.registerCommand('copilot-models.clearLog', () => {
		logger.core.info('clearLog command invoked');
		logger.clear();
	});

	// Refresh models
	vscode.commands.registerCommand('copilot-models.refreshModels', async () => {
		logger.core.info('refreshModels command invoked');
		modelRouter?.refreshModelPicker();
		logger.core.info('Models refreshed successfully');
	});

	// Show routing statistics
	vscode.commands.registerCommand('copilot-models.showLatencyStats', () => {
		if (!modelRouter) { return; }
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
 * Extension deactivation entry
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

	// Clear registry
	ModelRegistry.getInstance().clear();
	ProviderFactoryRegistry.getInstance().clear();

	logger.core.info('Extension deactivated');
	logger.dispose();
}
