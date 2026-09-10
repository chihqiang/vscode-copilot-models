/**
 * Vision model wizard — set and clear vision proxy configuration
 */

import vscode from "vscode";
import {
  logger,
  CONFIG_SECTION,
  VISION_API_ENDPOINT_ID,
  getVisionLanguageModelOptions,
  storeVisionProxyApiKey,
  clearVisionProxyApiKey,
  hasVisionProxyApiKey,
  SETTING_VISION_MODEL,
  SETTING_VISION_PROXY_API_MODEL_ID,
  SETTING_VISION_PROXY_API_URL,
} from "../core";
import { confirmAction } from "./utils";

/**
 * Set Vision Model wizard:
 * 1. Let user select a vision model or API endpoint
 * 2. Configure the vision proxy
 */
export async function openSetVisionModelWizard(
  context: vscode.ExtensionContext,
): Promise<void> {
  const options = await getVisionLanguageModelOptions();

  if (options.length === 0) {
    vscode.window.showInformationMessage("No vision models available");
    return;
  }

  const selected = await vscode.window.showQuickPick(
    [
      ...options.map((opt) => ({
        label: opt.label,
        description: opt.description,
        value: opt.id,
      })),
      {
        label: "Custom API Endpoint",
        description: "Use an OpenAI-compatible API endpoint",
        value: VISION_API_ENDPOINT_ID,
      },
    ],
    {
      title: "Set Vision Model",
      placeHolder: "Select a vision model for image description",
      ignoreFocusOut: true,
    },
  );

  if (!selected) {
    return;
  }

  if (selected.value === VISION_API_ENDPOINT_ID) {
    await configureApiEndpoint(context);
  } else {
    await configureVisionModel(selected.value);
  }
}

/**
 * Clear Vision Model wizard:
 * 1. Confirm and clear vision proxy configuration
 */
export async function openClearVisionModelWizard(
  context: vscode.ExtensionContext,
): Promise<void> {
  const confirmed = await confirmAction(
    "Clear vision model configuration?",
    "Clear",
  );
  if (!confirmed) {
    return;
  }

  const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
  await config.update(
    SETTING_VISION_MODEL,
    undefined,
    vscode.ConfigurationTarget.Global,
  );
  await config.update(
    SETTING_VISION_PROXY_API_URL,
    undefined,
    vscode.ConfigurationTarget.Global,
  );
  await config.update(
    SETTING_VISION_PROXY_API_MODEL_ID,
    undefined,
    vscode.ConfigurationTarget.Global,
  );
  await clearVisionProxyApiKey(context.secrets);

  logger.auth.info("Vision model configuration cleared");
  vscode.window.showInformationMessage("Vision model configuration cleared");
}

async function configureVisionModel(modelId: string): Promise<void> {
  const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
  await config.update(
    SETTING_VISION_MODEL,
    modelId,
    vscode.ConfigurationTarget.Global,
  );

  logger.auth.info(`Vision model configured: ${modelId}`);
  vscode.window.showInformationMessage(`Vision model configured: ${modelId}`);
}

async function configureApiEndpoint(
  context: vscode.ExtensionContext,
): Promise<void> {
  const apiUrl = await vscode.window.showInputBox({
    prompt: "Enter API endpoint URL",
    placeHolder: "https://api.example.com/v1",
    ignoreFocusOut: true,
    validateInput: (value: string) => {
      if (!value?.trim()) {
        return "URL is required";
      }
      try {
        new URL(value);
        return undefined;
      } catch {
        return "Invalid URL format";
      }
    },
  });

  if (!apiUrl) {
    return;
  }

  const apiModelId = await vscode.window.showInputBox({
    prompt: "Enter model ID",
    placeHolder: "gpt-4o",
    ignoreFocusOut: true,
    validateInput: (value: string) => {
      if (!value?.trim()) {
        return "Model ID is required";
      }
      return undefined;
    },
  });

  if (!apiModelId) {
    return;
  }

  // The endpoint may require authentication. Previously the key was never
  // requested nor stored, so every authenticated endpoint failed at request
  // time with "API key not configured for vision proxy".
  const existingKey = await hasVisionProxyApiKey(context.secrets);
  const apiKey = await vscode.window.showInputBox({
    title: "Vision API Key",
    prompt: existingKey
      ? "Enter the API key (leave empty to keep the stored key)"
      : "Enter the API key (leave empty for unauthenticated endpoints)",
    placeHolder: existingKey ? "(leave empty to keep current key)" : "sk-...",
    password: true,
    ignoreFocusOut: true,
  });

  // `undefined` means the user dismissed the input box.
  if (apiKey === undefined) {
    return;
  }
  if (apiKey.trim()) {
    await storeVisionProxyApiKey(context.secrets, apiKey);
  }

  const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
  await config.update(
    SETTING_VISION_MODEL,
    VISION_API_ENDPOINT_ID,
    vscode.ConfigurationTarget.Global,
  );
  await config.update(
    SETTING_VISION_PROXY_API_URL,
    apiUrl,
    vscode.ConfigurationTarget.Global,
  );
  await config.update(
    SETTING_VISION_PROXY_API_MODEL_ID,
    apiModelId,
    vscode.ConfigurationTarget.Global,
  );

  logger.auth.info(
    `Vision API endpoint configured: ${apiUrl} (${apiModelId}, apiKey=${apiKey.trim() || existingKey ? "configured" : "none"})`,
  );
  vscode.window.showInformationMessage(
    `Vision API endpoint configured: ${apiModelId}`,
  );
}
