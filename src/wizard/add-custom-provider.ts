import vscode from "vscode";
import { CONFIG_SECTION } from "../core/models";
import type { CustomProviderEntry } from "../core/provider-loader";
import { logger } from "../core/logger";

type ThinkingParamType = "reasoning_effort" | "thinking_enabled" | "none";

interface ModelData {
  id: string;
  name?: string;
  maxInputTokens?: number;
  maxOutputTokens?: number;
  toolCalling?: boolean;
  imageInput?: boolean;
  thinking?: boolean;
}

async function promptProviderId(existingIds: Set<string>): Promise<string | undefined> {
  const id = await vscode.window.showInputBox({
    title: "Add Custom Provider (1/7)",
    prompt: "Enter a unique Provider ID (e.g. my-provider)",
    placeHolder: "my-provider",
    validateInput: (value) => {
      const v = value.trim();
      if (!v) return "Provider ID is required";
      if (!/^[a-z0-9][a-z0-9-]*$/.test(v)) return "Only lowercase letters, numbers, and hyphens allowed";
      if (existingIds.has(v)) return `Provider "${v}" already exists`;
      return null;
    },
    ignoreFocusOut: true,
  });
  return id?.trim();
}

async function promptProviderName(): Promise<string | undefined> {
  return vscode.window.showInputBox({
    title: "Add Custom Provider (2/7)",
    prompt: "Enter a display name (e.g. My Provider)",
    placeHolder: "My Provider",
    validateInput: (value) => (value.trim() ? null : "Provider name is required"),
    ignoreFocusOut: true,
  });
}

async function promptBaseUrl(): Promise<string | undefined> {
  return vscode.window.showInputBox({
    title: "Add Custom Provider (3/7)",
    prompt: "Enter the OpenAI-compatible API base URL",
    placeHolder: "https://api.example.com/v1",
    validateInput: (value) => {
      const v = value.trim();
      if (!v) return "Base URL is required";
      if (!v.startsWith("http://") && !v.startsWith("https://")) return "URL must start with http:// or https://";
      return null;
    },
    ignoreFocusOut: true,
  });
}

async function promptApiKeyPrompt(): Promise<string | undefined> {
  const value = await vscode.window.showInputBox({
    title: "Add Custom Provider (4/7)",
    prompt: "API key prompt text shown to the user (optional, press Enter to skip)",
    placeHolder: "Enter your API Key",
    ignoreFocusOut: true,
  });
  return value?.trim() || undefined;
}

async function promptApiKeyPlaceholder(): Promise<string | undefined> {
  const value = await vscode.window.showInputBox({
    title: "Add Custom Provider (5/7)",
    prompt: "API key input placeholder (optional, press Enter to skip)",
    placeHolder: "sk-xxxxxxxxxxxxxxxxxxxxxxxx",
    ignoreFocusOut: true,
  });
  return value?.trim() || undefined;
}

async function promptThinkingParamType(): Promise<ThinkingParamType> {
  const pick = await vscode.window.showQuickPick(
    [
      {
        label: "reasoning_effort",
        description: "OpenAI-compatible (default)",
        detail: "Uses reasoning_effort parameter (low, high, max)",
      },
      {
        label: "thinking_enabled",
        description: "Anthropic-compatible",
        detail: "Uses thinking.type parameter (enabled/disabled)",
      },
      {
        label: "none",
        description: "Not supported",
        detail: "Disable thinking/reasoning parameter",
      },
    ],
    {
      title: "Add Custom Provider (6/7)",
      placeHolder: "Select thinking parameter type",
      ignoreFocusOut: true,
    },
  );
  return (pick?.label as ThinkingParamType) ?? "reasoning_effort";
}

async function promptModelId(existingModelIds: string[]): Promise<string | undefined> {
  return vscode.window.showInputBox({
    title: "Add Model",
    prompt: "Enter model ID (e.g. model-x)",
    placeHolder: "model-x",
    validateInput: (value) => {
      const v = value.trim();
      if (!v) return "Model ID is required";
      if (existingModelIds.includes(v)) return `Model "${v}" already added`;
      return null;
    },
    ignoreFocusOut: true,
  });
}

async function promptAddAnotherModel(currentCount: number): Promise<boolean> {
  const pick = await vscode.window.showQuickPick(
    [
      { label: "Yes", description: "Add another model" },
      { label: "No", description: "Continue to save" },
    ],
    {
      title: `Models (${currentCount} added)`,
      placeHolder: "Add another model?",
      ignoreFocusOut: true,
    },
  );
  return pick?.label === "Yes";
}

async function promptConfirm(
  providerId: string,
  providerName: string,
  baseUrl: string,
  models: ModelData[],
): Promise<boolean> {
  const lines = [
    `Provider: ${providerId} (${providerName})`,
    `Base URL: ${baseUrl}`,
    `Models: ${models.length > 0 ? models.map((m) => m.id).join(", ") : "default (auto-created)"}`,
  ];
  const pick = await vscode.window.showQuickPick(
    [
      { label: "$(check) Save", description: "Save this provider" },
      { label: "$(edit) Edit", description: "Go back and edit" },
      { label: "$(circle-slash) Cancel", description: "Discard and exit" },
    ],
    {
      title: "Add Custom Provider (7/7) — Review",
      placeHolder: lines.join(" | "),
      ignoreFocusOut: true,
    },
  );
  return pick?.label === "$(check) Save";
}

async function promptAddAnotherProvider(): Promise<boolean> {
  const pick = await vscode.window.showQuickPick(
    [
      { label: "Yes", description: "Add another provider" },
      { label: "No", description: "Finish" },
    ],
    {
      title: "Provider Saved",
      placeHolder: "Add another provider?",
      ignoreFocusOut: true,
    },
  );
  return pick?.label === "Yes";
}

async function collectModels(): Promise<ModelData[]> {
  const models: ModelData[] = [];

  const addModel = async (): Promise<boolean> => {
    const existingIds = models.map((m) => m.id);

    const id = await promptModelId(existingIds);
    if (!id) return false;

    const name = await vscode.window.showInputBox({
      title: `Model "${id}"`,
      prompt: "Model display name (optional, press Enter to skip)",
      placeHolder: id,
      ignoreFocusOut: true,
    });

    const maxInputStr = await vscode.window.showInputBox({
      title: `Model "${id}"`,
      prompt: "Max input tokens (optional, press Enter to skip)",
      placeHolder: "128000",
      validateInput: (v) => (v && isNaN(Number(v)) ? "Must be a number" : null),
      ignoreFocusOut: true,
    });

    const maxOutputStr = await vscode.window.showInputBox({
      title: `Model "${id}"`,
      prompt: "Max output tokens (optional, press Enter to skip)",
      placeHolder: "4096",
      validateInput: (v) => (v && isNaN(Number(v)) ? "Must be a number" : null),
      ignoreFocusOut: true,
    });

    const capabilities = await vscode.window.showQuickPick(
      [
        { label: "Tool Calling", picked: false },
        { label: "Image Input", picked: false },
        { label: "Thinking Mode", picked: false },
      ],
      {
        title: `Model "${id}" — Capabilities`,
        placeHolder: "Select capabilities (Space to toggle)",
        canPickMany: true,
        ignoreFocusOut: true,
      },
    );

    const capSet = new Set(capabilities?.map((c) => c.label) ?? []);

    models.push({
      id,
      ...(name?.trim() ? { name: name.trim() } : {}),
      ...(maxInputStr ? { maxInputTokens: parseInt(maxInputStr, 10) } : {}),
      ...(maxOutputStr ? { maxOutputTokens: parseInt(maxOutputStr, 10) } : {}),
      ...(capSet.has("Tool Calling") ? { toolCalling: true } : {}),
      ...(capSet.has("Image Input") ? { imageInput: true } : {}),
      ...(capSet.has("Thinking Mode") ? { thinking: true } : {}),
    });

    return promptAddAnotherModel(models.length);
  };

  const shouldAdd = await vscode.window.showQuickPick(
    [
      { label: "Yes", description: "Add model definitions" },
      { label: "No", description: "Use a single default model", detail: "A model named 'default' will be auto-created" },
    ],
    {
      title: "Add Custom Provider — Models",
      placeHolder: "Do you want to define models?",
      ignoreFocusOut: true,
    },
  );
  if (shouldAdd?.label === "No") return models;

  let keepGoing = true;
  while (keepGoing) {
    keepGoing = await addModel();
  }

  return models;
}

function buildEntry(data: {
  providerId: string;
  providerName: string;
  baseUrl: string;
  apiKeyPrompt?: string;
  apiKeyPlaceholder?: string;
  thinkingParamType: ThinkingParamType;
  models: ModelData[];
}): CustomProviderEntry {
  const entry: CustomProviderEntry = {
    providerId: data.providerId,
    providerName: data.providerName,
    baseUrl: data.baseUrl.replace(/\/+$/, ""),
    thinkingParamType: data.thinkingParamType,
    ...(data.apiKeyPrompt ? { apiKeyPrompt: data.apiKeyPrompt } : {}),
    ...(data.apiKeyPlaceholder ? { apiKeyPlaceholder: data.apiKeyPlaceholder } : {}),
  };

  const models = data.models
    .filter((m) => m.id)
    .map((m) => ({
      id: m.id,
      ...(m.name ? { name: m.name } : {}),
      ...(m.maxInputTokens ? { maxInputTokens: m.maxInputTokens } : {}),
      ...(m.maxOutputTokens ? { maxOutputTokens: m.maxOutputTokens } : {}),
      ...(m.toolCalling ? { toolCalling: true } : {}),
      ...(m.imageInput ? { imageInput: true } : {}),
      ...(m.thinking ? { thinking: true } : {}),
    }));

  if (models.length > 0) {
    entry.models = models;
  }

  return entry;
}

async function addSingleProvider(config: vscode.WorkspaceConfiguration, existingIds: Set<string>): Promise<boolean> {
  const providerId = await promptProviderId(existingIds);
  if (!providerId) return false;

  const providerName = await promptProviderName();
  if (!providerName) return false;

  const baseUrl = await promptBaseUrl();
  if (!baseUrl) return false;

  const apiKeyPrompt = await promptApiKeyPrompt();
  const apiKeyPlaceholder = await promptApiKeyPlaceholder();
  const thinkingParamType = await promptThinkingParamType();
  const models = await collectModels();

  const confirmed = await promptConfirm(providerId, providerName, baseUrl, models);
  if (!confirmed) return false;

  const entry = buildEntry({
    providerId,
    providerName,
    baseUrl,
    ...(apiKeyPrompt !== undefined ? { apiKeyPrompt } : {}),
    ...(apiKeyPlaceholder !== undefined ? { apiKeyPlaceholder } : {}),
    thinkingParamType,
    models,
  });
  const existing = config.get<CustomProviderEntry[]>("customProviders", []);
  existing.push(entry);

  await config.update("customProviders", existing, vscode.ConfigurationTarget.Global);

  logger.core.info(`Custom provider added via wizard: ${providerName} (${providerId})`);
  vscode.window.showInformationMessage(`Custom provider "${providerName}" added.`);

  return true;
}

export async function openAddCustomProviderWizard(): Promise<void> {
  const config = vscode.workspace.getConfiguration(CONFIG_SECTION);

  let keepGoing = true;
  while (keepGoing) {
    const existing = config.get<CustomProviderEntry[]>("customProviders", []);
    const existingIds = new Set(existing.map((e) => e.providerId));

    const saved = await addSingleProvider(config, existingIds);
    if (!saved) {
      keepGoing = false;
    } else {
      keepGoing = await promptAddAnotherProvider();
    }
  }
}
