/**
 * VS Code Copilot Models extension main entry
 *
 * Supports multiple language models for VS Code Copilot Chat
 * Uses ModelRouter for unified routing with failover and latency tracking
 */

import vscode from 'vscode';
import { applyLogLevelFromConfig, discoverAllProviders, IChatProvider, initLogger, IProviderFactory, logger, ModelRouter, Registry } from './core';
import { getBuiltInProviderFactories } from './providers';

class CopilotModelsExtension {
  private modelRouter: ModelRouter | undefined;
  private registrationDisposables = new Map<string, vscode.Disposable>();

  async activate(context: vscode.ExtensionContext): Promise<void> {
    try {
      initLogger(context);
      logger.core.info(`Activating extension`, {
        name: context.extension.packageJSON.displayName,
        version: context.extension.packageJSON.version,
        extensionKind: context.extension.extensionKind,
        vscode: vscode.version,
        uiKind: vscode.env.uiKind,
        platform: process.platform,
        arch: process.arch,
      });

      await discoverAllProviders(getBuiltInProviderFactories(), context);

      const factories = Registry.getInstance().getEnabledFactories();
      logger.core.info(`Found ${factories.length} enabled provider(s)`);

      this.modelRouter = new ModelRouter();
      for (const factory of factories) {
        this.registerProvider(factory, context);
      }

      const routerDisposable = vscode.lm.registerLanguageModelChatProvider('copilot-models-router', this.modelRouter);
      context.subscriptions.push(routerDisposable);
      this.registrationDisposables.set('copilot-models-router', routerDisposable);

      this.registerCommands();

      context.subscriptions.push(
        vscode.workspace.onDidChangeConfiguration(async (e) => {
          if (!e.affectsConfiguration('copilot-models')) { return; }

          if (e.affectsConfiguration('copilot-models.debugMode')) {
            applyLogLevelFromConfig();
            logger.core.info(`Log level updated to: ${logger.level}`);
          }

          const allFactories = Registry.getInstance().getAllFactories();
          let routerChanged = false;

          for (const factory of allFactories) {
            const isNowEnabled = factory.isEnabled();
            const isCurrentlyRegistered = this.modelRouter?.hasProvider(factory.providerId) ?? false;

            if (isNowEnabled && !isCurrentlyRegistered) {
              logger.core.info(`Config changed: enabling provider "${factory.providerId}"`);
              this.registerProvider(factory, context);
              routerChanged = true;
            } else if (!isNowEnabled && isCurrentlyRegistered) {
              logger.core.info(`Config changed: disabling provider "${factory.providerId}"`);
              await this.unregisterProvider(factory.providerId);
              routerChanged = true;
            }
          }

          if (routerChanged && this.modelRouter) {
            this.modelRouter.refreshModelPicker();
          }
        }),
      );

      logger.core.info(`Extension activated successfully with ${factories.length} provider(s): ${factories.map((f) => f.providerId).join(', ')}`);
      logger.show();
    } catch (error) {
      logger.core.error('Failed to activate extension:', error);
      throw error;
    }
  }

  async deactivate(): Promise<void> {
    logger.core.info('Deactivating extension...');

    if (this.modelRouter) {
      await this.modelRouter.prepareForDeactivate();
      this.modelRouter.dispose();
      this.modelRouter = undefined;
    }

    for (const [providerId, disposable] of this.registrationDisposables) {
      try {
        disposable.dispose();
        logger.core.info(`Disposable "${providerId}" disposed`);
      } catch (error) {
        logger.core.error(`Failed to dispose "${providerId}":`, error);
      }
    }
    this.registrationDisposables.clear();

    Registry.getInstance().clear();
    Registry.getInstance().clear();

    logger.core.info('Extension deactivated');
    logger.dispose();
  }

  private async selectProvider(factories: IProviderFactory[]): Promise<IProviderFactory | undefined> {
    if (factories.length === 0) {
      vscode.window.showWarningMessage('No model providers enabled');
      return undefined;
    }

    if (factories.length === 1) {
      return factories[0];
    }

    const selected = await vscode.window.showQuickPick(
      factories.map((f) => ({ label: f.providerName, id: f.providerId })),
      { placeHolder: 'Select a model provider' },
    );

    if (!selected) { return undefined; }

    return factories.find((f) => f.providerId === selected.id);
  }

  private registerProvider(factory: IProviderFactory, context: vscode.ExtensionContext): IChatProvider {
    const { providerId, providerName } = factory;

    logger.core.debug(`Creating provider: ${providerName} (${providerId})...`);

    const chatProvider = factory.createChatProvider(context);
    const registry = Registry.getInstance();
    const modelProvider = registry.getProvider(providerId);
    const models = modelProvider?.getModels().map((m) => m.id) ?? [];

    if (this.modelRouter) {
      this.modelRouter.addProvider(providerId, chatProvider, models);
    } else {
      const disposable = vscode.lm.registerLanguageModelChatProvider(providerId, chatProvider);
      context.subscriptions.push(disposable);
      this.registrationDisposables.set(providerId, disposable);
    }

    logger.core.debug(`${providerName} provider registered successfully`);
    return chatProvider;
  }

  private async unregisterProvider(providerId: string): Promise<void> {
    this.modelRouter?.removeProvider(providerId);

    const disposable = this.registrationDisposables.get(providerId);
    if (disposable) {
      disposable.dispose();
      this.registrationDisposables.delete(providerId);
    }

    Registry.getInstance().unregisterProvider(providerId);
    logger.core.debug(`Provider "${providerId}" unregistered`);
  }

  private registerCommands(): void {
    vscode.commands.registerCommand('copilot-models.setApiKey', async () => {
      if (this.modelRouter) {
        await this.modelRouter.configureApiKey();
      }
    });

    vscode.commands.registerCommand('copilot-models.clearApiKey', async () => {
      if (this.modelRouter) {
        await this.modelRouter.clearApiKey();
      }
    });

    vscode.commands.registerCommand('copilot-models.openSettings', () => {
      logger.core.info('openSettings command invoked');
      vscode.commands.executeCommand('workbench.action.openSettings', 'copilot-models');
    });

    vscode.commands.registerCommand('copilot-models.showLog', () => {
      logger.core.info('showLog command invoked');
      logger.show();
    });

    vscode.commands.registerCommand('copilot-models.clearLog', () => {
      logger.core.info('clearLog command invoked');
      logger.clear();
    });

    vscode.commands.registerCommand('copilot-models.refreshModels', async () => {
      logger.core.info('refreshModels command invoked');
      this.modelRouter?.refreshModelPicker();
      logger.core.info('Models refreshed successfully');
    });

    vscode.commands.registerCommand('copilot-models.showLatencyStats', () => {
      if (!this.modelRouter) { return; }
      const stats = this.modelRouter.latencyTracker.getAllStats();
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
}

const extension = new CopilotModelsExtension();

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  return extension.activate(context);
}

export async function deactivate(): Promise<void> {
  return extension.deactivate();
}
