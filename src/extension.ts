/**
 * VS Code Copilot Models extension main entry
 *
 * Supports multiple language models for VS Code Copilot Chat
 * Uses ModelRouter for unified routing with failover and latency tracking
 */

import vscode from "vscode";
import {
  CONFIG_SECTION,
  Logger,
  IChatProvider,
  IProviderFactory,
  ROUTER_VENDOR_ID,
  logger,
  ModelRouter,
  ProviderModels,
  SETTING_DEBUG_MODE,
  SETTING_FAILOVER_MODELS,
  SETTING_ROUTING_STRATEGY,
  settingKey,
} from "./core";
import { TokenPlan } from "./core/token-plan";
import { Tokenizer } from "./core/tokenizer";
import { builtInProviders } from "./providers";
import { builtInPresets } from "./plans";
import { registerAllCommands } from "./commands";
import { UsageStatusBar } from "./ui/status-bar";

class CopilotModelsExtension {
  private modelRouter: ModelRouter | undefined;
  private registrationDisposables = new Map<string, vscode.Disposable>();

  async activate(context: vscode.ExtensionContext): Promise<void> {
    try {
      Logger.init(context);
      TokenPlan.init(context, builtInPresets);
      logger.core.info(`Activating extension`, {
        name: context.extension.packageJSON.displayName,
        version: context.extension.packageJSON.version,
        extensionKind: context.extension.extensionKind,
        vscode: vscode.version,
        uiKind: vscode.env.uiKind,
        platform: process.platform,
        arch: process.arch,
      });

      const providerModels = ProviderModels.init(builtInProviders);
      providerModels.registerAll();

      const factories = ProviderModels.getInstance().getEnabledFactories();
      logger.core.info(`Found ${factories.length} enabled provider(s)`);

      this.modelRouter = new ModelRouter();
      for (const factory of factories) {
        this.registerProvider(factory, context);
      }

      const routerDisposable = vscode.lm.registerLanguageModelChatProvider(
        ROUTER_VENDOR_ID,
        this.modelRouter,
      );
      context.subscriptions.push(routerDisposable);
      this.registrationDisposables.set(ROUTER_VENDOR_ID, routerDisposable);

      registerAllCommands(context, this.modelRouter);

      // Status bar showing today's token usage; clicking it opens the report.
      context.subscriptions.push(new UsageStatusBar(TokenPlan.getInstance()));

      context.subscriptions.push(
        vscode.workspace.onDidChangeConfiguration((e) => {
          if (!e.affectsConfiguration(CONFIG_SECTION)) {
            return;
          }

          if (e.affectsConfiguration(settingKey(SETTING_DEBUG_MODE))) {
            logger.applyLogLevelFromConfig();
            logger.core.info(`Log level updated to: ${logger.level}`);
          }

          // Invalidate routing config cache so failoverModels /
          // routingStrategy changes take effect immediately
          if (
            e.affectsConfiguration(settingKey(SETTING_FAILOVER_MODELS)) ||
            e.affectsConfiguration(settingKey(SETTING_ROUTING_STRATEGY))
          ) {
            this.modelRouter?.invalidateConfigCache();
          }

          this.handleProviderConfigChange(e, context).catch((error) => {
            logger.core.error("Failed to handle configuration change:", error);
          });
        }),
      );

      logger.core.info(
        `Extension activated successfully with ${factories.length} provider(s): ${factories.map((f) => f.providerId).join(", ")}`,
      );
    } catch (error) {
      logger.core.error("Failed to activate extension:", error);
      throw error;
    }
  }

  async deactivate(): Promise<void> {
    logger.core.info("Deactivating extension...");

    try {
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

      // ProviderModels is a strict singleton: if activation failed before
      // init(), getInstance() throws. Guard it so a failed activation still
      // lets the rest of the teardown (and logger.dispose) run.
      if (ProviderModels.isInitialized()) {
        ProviderModels.getInstance().clear();
      }
      Tokenizer.getInstance().dispose();
      // Disposes the usage event emitter held by the status bar.
      TokenPlan.resetInstance();
    } catch (error) {
      logger.core.error("Failed to deactivate cleanly:", error);
    } finally {
      logger.core.info("Extension deactivated");
      logger.dispose();
    }
  }

  private registerProvider(
    factory: IProviderFactory,
    context: vscode.ExtensionContext,
  ): IChatProvider {
    const { providerId, providerName } = factory;

    logger.core.debug(`Creating provider: ${providerName} (${providerId})...`);

    const chatProvider = factory.createChatProvider(context);
    const modelProvider = ProviderModels.getInstance().getProvider(providerId);
    const models = modelProvider?.getModels().map((m) => m.id) ?? [];

    if (this.modelRouter) {
      this.modelRouter.addProvider(providerId, chatProvider, models);
    } else {
      const disposable = vscode.lm.registerLanguageModelChatProvider(
        providerId,
        chatProvider,
      );
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

    ProviderModels.getInstance().unregisterProvider(providerId);
    logger.core.debug(`Provider "${providerId}" unregistered`);
  }

  private async handleProviderConfigChange(
    _e: vscode.ConfigurationChangeEvent,
    context: vscode.ExtensionContext,
  ): Promise<void> {
    const allFactories = ProviderModels.getInstance().getAllFactories();
    let routerChanged = false;

    for (const factory of allFactories) {
      const isNowEnabled = factory.isEnabled();
      const isCurrentlyRegistered =
        this.modelRouter?.hasProvider(factory.providerId) ?? false;

      if (isNowEnabled && !isCurrentlyRegistered) {
        logger.core.info(
          `Config changed: enabling provider "${factory.providerId}"`,
        );
        this.registerProvider(factory, context);
        routerChanged = true;
      } else if (!isNowEnabled && isCurrentlyRegistered) {
        logger.core.info(
          `Config changed: disabling provider "${factory.providerId}"`,
        );
        await this.unregisterProvider(factory.providerId);
        routerChanged = true;
      }
    }

    if (routerChanged && this.modelRouter) {
      this.modelRouter.refreshModelPicker();
    }
  }
}

const extension = new CopilotModelsExtension();

export async function activate(
  context: vscode.ExtensionContext,
): Promise<void> {
  return extension.activate(context);
}

export async function deactivate(): Promise<void> {
  return extension.deactivate();
}
