/**
 * API Key wizard — set and clear API keys for providers
 */

import vscode from "vscode";
import { logger, ProviderModels } from "../core";

/**
 * Set API Key wizard:
 * 1. If multiple providers, let user pick one
 * 2. Prompt for the API key and store it
 */
export async function openSetApiKeyWizard(): Promise<void> {
  const pm = ProviderModels.getInstance();
  const factories = pm.getEnabledFactories();

  if (factories.length === 0) {
    vscode.window.showInformationMessage("No providers configured");
    return;
  }

  let providerId: string;

  if (factories.length === 1) {
    providerId = factories[0].providerId;
  } else {
    const selected = await vscode.window.showQuickPick(
      factories.map((f) => ({
        label: f.providerName,
        description: f.providerId,
        providerId: f.providerId,
      })),
      {
        title: "Set API Key",
        placeHolder: "Select a provider to configure API key",
        ignoreFocusOut: true,
      },
    );
    if (!selected) {
      return;
    }
    providerId = selected.providerId;
  }

  const modelProvider = pm.getProvider(providerId);
  if (!modelProvider) {
    logger.auth.error(`Provider "${providerId}" not found in registry`);
    return;
  }

  const saved = await modelProvider.promptForApiKey();
  if (saved) {
    logger.auth.info(`[${providerId}] API key configured successfully`);
    vscode.window.showInformationMessage(
      `${modelProvider.config.vendorName} API key configured`,
    );
  }
}

/**
 * Clear API Key wizard:
 * 1. Show providers that have API keys configured
 * 2. Let user pick one (or auto-select if only one)
 * 3. Confirm and delete
 */
export async function openClearApiKeyWizard(): Promise<void> {
  const pm = ProviderModels.getInstance();
  const factories = pm.getEnabledFactories();

  if (factories.length === 0) {
    vscode.window.showInformationMessage("No providers configured");
    return;
  }

  // Check which providers have API keys
  const providersWithKeys: Array<{
    providerId: string;
    providerName: string;
  }> = [];

  for (const factory of factories) {
    const provider = pm.getProvider(factory.providerId);
    if (provider && (await provider.hasApiKey())) {
      providersWithKeys.push({
        providerId: factory.providerId,
        providerName: factory.providerName,
      });
    }
  }

  if (providersWithKeys.length === 0) {
    vscode.window.showInformationMessage("No API keys configured");
    return;
  }

  let targetProviderId: string;
  let targetProviderName: string;

  if (providersWithKeys.length === 1) {
    targetProviderId = providersWithKeys[0].providerId;
    targetProviderName = providersWithKeys[0].providerName;
  } else {
    const selected = await vscode.window.showQuickPick(
      providersWithKeys.map((p) => ({
        label: p.providerName,
        description: p.providerId,
        providerId: p.providerId,
      })),
      {
        title: "Clear API Key",
        placeHolder: "Select a provider to clear API key",
        ignoreFocusOut: true,
      },
    );
    if (!selected) {
      return;
    }
    targetProviderId = selected.providerId;
    targetProviderName = selected.label;
  }

  const confirm = await vscode.window.showWarningMessage(
    `Clear ${targetProviderName} API key?`,
    { modal: true },
    "Clear",
    "Cancel",
  );
  if (confirm !== "Clear") {
    return;
  }

  const modelProvider = pm.getProvider(targetProviderId);
  if (modelProvider) {
    await modelProvider.deleteApiKey();
    logger.auth.info(`[${targetProviderId}] API key cleared`);
    vscode.window.showInformationMessage(
      `${targetProviderName} API key cleared`,
    );
  }
}
