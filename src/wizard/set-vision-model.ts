/**
 * Vision model wizard — set and clear vision proxy configuration
 */

import vscode from "vscode";
import { logger, getVisionLanguageModelOptions } from "../core";

/**
 * Set Vision Model wizard:
 * 1. Let user select a vision model or API endpoint
 * 2. Configure the vision proxy
 */
export async function openSetVisionModelWizard(): Promise<void> {
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
        value: "api:endpoint",
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

  if (selected.value === "api:endpoint") {
    await configureApiEndpoint();
  } else {
    await configureVisionModel(selected.value);
  }
}

/**
 * Clear Vision Model wizard:
 * 1. Confirm and clear vision proxy configuration
 */
export async function openClearVisionModelWizard(): Promise<void> {
  const confirm = await vscode.window.showWarningMessage(
    "Clear vision model configuration?",
    { modal: true },
    "Clear",
    "Cancel",
  );

  if (confirm !== "Clear") {
    return;
  }

  const config = vscode.workspace.getConfiguration("copilot-models");
  await config.update(
    "visionModel",
    undefined,
    vscode.ConfigurationTarget.Global,
  );
  await config.update(
    "visionProxy.apiUrl",
    undefined,
    vscode.ConfigurationTarget.Global,
  );
  await config.update(
    "visionProxy.apiModelId",
    undefined,
    vscode.ConfigurationTarget.Global,
  );

  logger.auth.info("Vision model configuration cleared");
  vscode.window.showInformationMessage("Vision model configuration cleared");
}

async function configureVisionModel(modelId: string): Promise<void> {
  const config = vscode.workspace.getConfiguration("copilot-models");
  await config.update(
    "visionModel",
    modelId,
    vscode.ConfigurationTarget.Global,
  );

  logger.auth.info(`Vision model configured: ${modelId}`);
  vscode.window.showInformationMessage(`Vision model configured: ${modelId}`);
}

async function configureApiEndpoint(): Promise<void> {
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

  const config = vscode.workspace.getConfiguration("copilot-models");
  await config.update(
    "visionModel",
    "api:endpoint",
    vscode.ConfigurationTarget.Global,
  );
  await config.update(
    "visionProxy.apiUrl",
    apiUrl,
    vscode.ConfigurationTarget.Global,
  );
  await config.update(
    "visionProxy.apiModelId",
    apiModelId,
    vscode.ConfigurationTarget.Global,
  );

  logger.auth.info(`Vision API endpoint configured: ${apiUrl} (${apiModelId})`);
  vscode.window.showInformationMessage(
    `Vision API endpoint configured: ${apiModelId}`,
  );
}
