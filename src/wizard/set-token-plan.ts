/**
 * Token Plan wizard — set and clear token plans
 */

import vscode from "vscode";
import { logger } from "../core/logger";
import {
  TokenPlan,
  type TokenPlanConfig,
  type TokenPlanModel,
  type ProviderPreset,
} from "../core/token-plan";
import { ProviderModels } from "../core/provider-models";

// ── Prompt helpers ───────────────────────────────────

function validateUrl(value: string): string | null {
  const v = value.trim();
  if (!v) {
    return "URL is required";
  }
  if (!v.startsWith("https://")) {
    return "URL must start with https:// for security";
  }
  return null;
}

async function promptPlanName(
  existingNames: string[],
): Promise<string | undefined> {
  return vscode.window.showInputBox({
    title: "Set Token Plan (1/4) — Name",
    prompt: "Enter a name for this token plan (optional, press Enter to skip)",
    placeHolder: "My Token Plan",
    validateInput: (value) => {
      const v = value.trim();
      if (!v) {
        return null;
      }
      if (existingNames.includes(v)) {
        return `Plan "${v}" already exists`;
      }
      return null;
    },
    ignoreFocusOut: true,
  });
}

interface PresetQuickPickItem extends vscode.QuickPickItem {
  preset: ProviderPreset | null;
}

async function promptProviderOrUrl(
  presets: ProviderPreset[],
): Promise<{ baseUrl: string; preset?: ProviderPreset } | undefined> {
  // Build QuickPick items dynamically from presets
  const items: PresetQuickPickItem[] = [
    ...presets.map((preset) => ({
      label: preset.id,
      description: preset.defaultBaseUrl,
      detail: preset.models.map((m) => m.id).join(", "),
      preset,
    })),
    {
      label: "$(link) Custom URL",
      description: "Enter a custom API endpoint URL",
      preset: null,
    },
  ];

  const picked = await vscode.window.showQuickPick(items, {
    title: "Set Token Plan (2/4) — Select Provider",
    placeHolder: "Choose a provider or enter a custom URL",
    ignoreFocusOut: true,
  });
  if (!picked) {
    return undefined;
  }

  if (picked.preset) {
    const confirmedUrl = await vscode.window.showInputBox({
      title: `Set Token Plan (2/4) — ${picked.preset.id}`,
      prompt: "Confirm or edit the API endpoint URL, then press Enter",
      value: picked.preset.defaultBaseUrl,
      validateInput: validateUrl,
      ignoreFocusOut: true,
    });
    if (!confirmedUrl) {
      return undefined;
    }
    return { baseUrl: confirmedUrl.trim(), preset: picked.preset };
  }

  const url = await vscode.window.showInputBox({
    title: "Set Token Plan (2/4) — Custom URL",
    prompt: "Enter the plan API endpoint URL",
    placeHolder: "https://your-api-endpoint.com/v1",
    validateInput: validateUrl,
    ignoreFocusOut: true,
  });
  if (!url) {
    return undefined;
  }
  return { baseUrl: url.trim() };
}

async function promptToken(): Promise<string | undefined> {
  return vscode.window.showInputBox({
    title: "Set Token Plan (3/4) — API Token",
    prompt: "Enter the plan API token",
    placeHolder: "sk-or-token-xxxx",
    password: true,
    ignoreFocusOut: true,
  });
}

async function selectModels(
  models: TokenPlanModel[],
): Promise<TokenPlanModel[] | undefined> {
  if (models.length === 0) {
    return [];
  }

  const items = models.map((m) => ({
    label: m.id,
    picked: false,
  }));

  const picked = await vscode.window.showQuickPick(items, {
    title: "Set Token Plan (4/4) — Select Models",
    placeHolder: `Select models covered by this plan (${items.length} available)`,
    canPickMany: true,
    ignoreFocusOut: true,
  });
  if (!picked) {
    return undefined;
  }

  if (picked.length === 0) {
    const confirm = await vscode.window.showWarningMessage(
      "No models selected. The plan will cover no models. Continue?",
      { modal: true },
      "Go Back",
      "Save Anyway",
    );
    if (confirm !== "Save Anyway") {
      return undefined;
    }
  }

  return models.filter((m) => picked.some((p) => p.label === m.id));
}

async function promptEditModelsManually(): Promise<
  TokenPlanModel[] | undefined
> {
  const allModels = ProviderModels.getInstance().getAllModels();
  if (allModels.length === 0) {
    return [];
  }
  const items = allModels.map((m) => ({
    label: m.id,
    description: m.name,
    picked: false,
  }));
  const picked = await vscode.window.showQuickPick(items, {
    title: "Set Token Plan (4/4) — Select Models",
    placeHolder: `Select models covered by this plan (${items.length} available)`,
    canPickMany: true,
    ignoreFocusOut: true,
  });
  if (!picked) {
    return undefined;
  }
  if (picked.length === 0) {
    const confirm = await vscode.window.showWarningMessage(
      "No models selected. The plan will cover no models. Continue?",
      { modal: true },
      "Go Back",
      "Save Anyway",
    );
    if (confirm !== "Save Anyway") {
      return undefined;
    }
  }
  return picked.map((p) => ({ id: p.label }));
}

// ── Wizards ──────────────────────────────────────────

export async function openSetTokenPlanWizard(): Promise<void> {
  const tokenPlan = TokenPlan.getInstance();
  const presets = tokenPlan.getPresets();
  const existingNames = tokenPlan.getPlans().map((p) => p.planName);

  logger.plan.info("Starting Set Token Plan wizard");

  // Step 1: Name
  const planName = await promptPlanName(existingNames);
  if (planName === undefined) {
    logger.plan.info("Wizard cancelled at plan name step");
    return;
  }

  // Step 2: Provider / URL
  const providerResult = await promptProviderOrUrl(presets);
  if (!providerResult) {
    logger.plan.info("Wizard cancelled at provider/URL step");
    return;
  }

  let detectedPreset = providerResult.preset;
  const baseUrl = providerResult.baseUrl;

  if (!detectedPreset) {
    detectedPreset = tokenPlan.detectProviderFromUrl(baseUrl);
    if (detectedPreset) {
      logger.plan.info(
        `Detected provider: ${detectedPreset.id} (${detectedPreset.models.length} models)`,
      );
    }
  }

  // Step 3: Token
  const token = await promptToken();
  if (token === undefined) {
    logger.plan.info("Wizard cancelled at token step");
    return;
  }

  // Step 4: Models
  let selectedModels: TokenPlanModel[] | undefined;

  if (detectedPreset && detectedPreset.models.length > 0) {
    selectedModels = await selectModels(detectedPreset.models);
  } else {
    selectedModels = await promptEditModelsManually();
  }
  if (selectedModels === undefined) {
    logger.plan.info("Wizard cancelled at model selection step");
    return;
  }

  // Step 5: Save
  const planId = tokenPlan.generatePlanId(baseUrl);
  const plan: TokenPlanConfig = {
    planId,
    planName:
      planName.trim() || `Token Plan (${tokenPlan.extractHostname(baseUrl)})`,
    baseUrl: baseUrl.replace(/\/+$/, ""),
    providerId: detectedPreset?.id ?? tokenPlan.extractHostname(baseUrl),
    models: selectedModels,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  await tokenPlan.storeToken(planId, token);
  await tokenPlan.storePlan(plan);

  logger.plan.info(
    `Token plan saved: "${plan.planName}" (${plan.models.length} models)`,
  );
  vscode.window.showInformationMessage(
    `Token plan "${plan.planName}" configured with ${plan.models.length} model(s).`,
  );
}

/**
 * Clear Token Plan wizard:
 * 1. Show existing plans
 * 2. Let user pick one (or auto-select if only one)
 * 3. Confirm and delete
 */
export async function openClearTokenPlanWizard(): Promise<void> {
  const tokenPlan = TokenPlan.getInstance();
  const plans = tokenPlan.getPlans();

  if (plans.length === 0) {
    vscode.window.showInformationMessage("No token plans configured");
    return;
  }

  let targetPlanId: string;

  if (plans.length === 1) {
    targetPlanId = plans[0].planId;
  } else {
    const pick = await vscode.window.showQuickPick(
      plans.map((p) => ({
        label: p.planName,
        description: `${p.models.length} model(s)`,
        detail: p.baseUrl,
        planId: p.planId,
      })),
      {
        title: "Clear Token Plan",
        placeHolder: "Select plan to clear",
        ignoreFocusOut: true,
      },
    );
    if (!pick) {
      return;
    }
    targetPlanId = pick.planId;
  }

  const confirm = await vscode.window.showWarningMessage(
    "Are you sure you want to clear this token plan?",
    { modal: true },
    "Clear",
    "Cancel",
  );
  if (confirm !== "Clear") {
    return;
  }

  await tokenPlan.removeToken(targetPlanId);
  await tokenPlan.removePlan(targetPlanId);
  logger.plan.info(`Token plan cleared: ${targetPlanId}`);
  vscode.window.showInformationMessage("Token plan cleared");
}
