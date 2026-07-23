/**
 * Vision proxy module - Image description for non-vision models
 *
 * Provides vision proxy functionality to describe images using
 * VS Code Language Models or custom API endpoints.
 */

import vscode from "vscode";
import { logger } from "./logger";
import { CONFIG_SECTION } from "./models";

// ── Constants ───────────────────────────────────────────────

/** Prefix for image description text */
export const IMAGE_DESCRIPTION_PREFIX = "[Image: ";

/** Suffix for image description text */
export const IMAGE_DESCRIPTION_SUFFIX = "]";

/** Text when image description is unavailable */
export const IMAGE_DESCRIPTION_UNAVAILABLE =
  "[Image: description unavailable]";

/** Default vision prompt */
export const DEFAULT_VISION_PROMPT = `Describe all image attachments in this message.

If there is one image, describe it directly.
If there are multiple images:
1. Describe each image separately, preserving their order.
2. Then provide a combined description explaining the overall context and relationships across the images.

Return one concise factual description suitable for inserting into a text-only chat prompt. Include visible text, objects, UI elements, people, and relevant context. Do not invent details.`;

/** SecretStorage key for vision proxy API key */
export const VISION_PROXY_API_KEY_SECRET =
  "copilot-models.visionProxy.apiKey";

// ── Types ───────────────────────────────────────────────────

/**
 * Vision proxy source type
 */
export type VisionProxySource = "vscode-lm" | "api-endpoint";

/**
 * Vision image part
 */
export interface VisionImagePart {
  mimeType: string;
  data: Uint8Array;
}

/**
 * Separated message parts
 */
interface MessageParts {
  imageParts: vscode.LanguageModelDataPart[];
  textParts: vscode.LanguageModelTextPart[];
}

/**
 * Vision description request
 */
export interface VisionDescriptionRequest {
  prompt: string;
  images: readonly VisionImagePart[];
  token: vscode.CancellationToken;
}

/**
 * Vision describer interface
 */
export interface VisionDescriber {
  readonly id: string;
  readonly source: VisionProxySource;
  describe(request: VisionDescriptionRequest): Promise<string>;
}

/**
 * Vision resolution statistics
 */
export interface VisionResolutionStats {
  inputImageParts: number;
  inputImageMessages: number;
  currentImageMessages: number;
  generatedImageMessages: number;
  unavailableImageMessages: number;
  failedImageMessages: number;
  omittedImageMessages: number;
  droppedImageParts: number;
}

/**
 * Vision resolution result
 */
export interface VisionResolutionResult {
  messages: readonly vscode.LanguageModelChatRequestMessage[];
  stats: VisionResolutionStats;
  visionModelId?: string | undefined;
  visionProxySource?: VisionProxySource | undefined;
  initialResponseNotice?: string | undefined;
}

/**
 * Vision language model option
 */
export interface VisionLanguageModelOption {
  key: string;
  id: string;
  vendor: string;
  name: string;
  family: string;
  version: string;
  label: string;
  description: string;
}

// ── VS Code LM Vision Describer ─────────────────────────────

/**
 * VS Code Language Model based vision describer
 */
export class VSCodeLMVisionDescriber implements VisionDescriber {
  readonly id: string;
  readonly source = "vscode-lm" as const;

  private readonly visionModelId: string | undefined;
  private readonly visionPrompt: string;

  constructor() {
    const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
    this.visionModelId = config.get<string>("visionModel");
    this.visionPrompt =
      config.get<string>("visionPrompt") || DEFAULT_VISION_PROMPT;
    this.id = this.visionModelId
      ? `vscode-lm:${this.visionModelId}`
      : "vscode-lm:auto";
  }

  async describe(request: VisionDescriptionRequest): Promise<string> {
    const prompt = request.prompt || this.visionPrompt;

    try {
      const selector: vscode.LanguageModelChatSelector = this.visionModelId
        ? { family: this.visionModelId }
        : {};

      const models = await vscode.lm.selectChatModels(selector);

      if (!models || models.length === 0) {
        logger.vision.warn("No vision models available");
        return "";
      }

      const model = models[0];
      logger.vision.info(
        `Using vision model: ${model.id} (${model.family}/${model.name})`,
      );

      const imageParts = request.images.map(
        (img) => new vscode.LanguageModelDataPart(img.data, img.mimeType),
      );

      const content: (
        | vscode.LanguageModelTextPart
        | vscode.LanguageModelDataPart
      )[] = [new vscode.LanguageModelTextPart(prompt), ...imageParts];

      const messages: vscode.LanguageModelChatMessage[] = [
        vscode.LanguageModelChatMessage.User(content),
      ];

      const response = await model.sendRequest(messages, {}, request.token);
      let description = "";

      for await (const part of response.text) {
        description += part;
      }

      logger.vision.debug(
        `Vision description generated: ${description.length} chars`,
      );

      return description.trim();
    } catch (error) {
      logger.vision.error("Failed to generate vision description:", error);
      throw error;
    }
  }
}

// ── API Endpoint Vision Describer ───────────────────────────

/**
 * API endpoint configuration
 */
export interface ApiEndpointConfig {
  url: string;
  modelId: string;
  apiKey?: string;
  maxTokens?: number | undefined;
  timeoutMs?: number | undefined;
}

/**
 * API Endpoint based vision describer
 */
export class ApiEndpointVisionDescriber implements VisionDescriber {
  readonly id: string;
  readonly source = "api-endpoint" as const;

  private readonly config: ApiEndpointConfig;
  private readonly secretStorage: vscode.SecretStorage;

  constructor(config: ApiEndpointConfig, secretStorage: vscode.SecretStorage) {
    this.config = config;
    this.secretStorage = secretStorage;
    this.id = `api-endpoint:${config.modelId}`;
  }

  async describe(request: VisionDescriptionRequest): Promise<string> {
    const apiKey = this.config.apiKey || (await this.getApiKey());
    if (!apiKey) {
      throw new Error("API key not configured for vision proxy");
    }

    const controller = new AbortController();
    const timeoutMs = this.config.timeoutMs ?? 60_000;
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const cancelListener = request.token.onCancellationRequested(() => {
      controller.abort();
    });

    try {
      const imageContents = request.images.map((img) => ({
        type: "image_url",
        image_url: {
          url: `data:${img.mimeType};base64,${Buffer.from(img.data).toString("base64")}`,
        },
      }));

      const requestBody = {
        model: this.config.modelId,
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: request.prompt },
              ...imageContents,
            ],
          },
        ],
        max_tokens: this.config.maxTokens ?? 1024,
      };

      logger.vision.debug(
        `Sending vision request to ${this.config.url}, model: ${this.config.modelId}, timeout: ${timeoutMs}ms`,
      );

      const response = await fetch(`${this.config.url}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(requestBody),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => "Unknown error");
        throw new Error(
          `Vision API request failed: ${response.status} ${errorText}`,
        );
      }

      const result = (await response.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      const description = result.choices?.[0]?.message?.content || "";

      logger.vision.debug(
        `Vision description generated: ${description.length} chars`,
      );

      return description.trim();
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        if (request.token.isCancellationRequested) {
          throw new Error("Vision request cancelled");
        }
        throw new Error(`Vision API request timed out after ${timeoutMs}ms`);
      }
      logger.vision.error("Failed to generate vision description:", error);
      throw error;
    } finally {
      clearTimeout(timeout);
      cancelListener.dispose();
    }
  }

  private async getApiKey(): Promise<string | undefined> {
    return this.secretStorage.get(VISION_PROXY_API_KEY_SECRET);
  }
}

// ── Vision Service ──────────────────────────────────────────

/**
 * Vision proxy service
 */
export class VisionService {
  private describer: VisionDescriber | undefined;
  private readonly disposables: vscode.Disposable[] = [];

  constructor(private readonly context: vscode.ExtensionContext) {
    this.disposables.push(
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (
          e.affectsConfiguration(`${CONFIG_SECTION}.visionModel`) ||
          e.affectsConfiguration(`${CONFIG_SECTION}.visionPrompt`) ||
          e.affectsConfiguration(`${CONFIG_SECTION}.visionProxy.apiUrl`) ||
          e.affectsConfiguration(`${CONFIG_SECTION}.visionProxy.apiModelId`)
        ) {
          this.reset();
        }
      }),
      context.secrets.onDidChange((e) => {
        if (e.key === VISION_PROXY_API_KEY_SECRET) {
          this.reset();
        }
      }),
    );
  }

  /**
   * Get the current vision describer
   */
  async get(): Promise<VisionDescriber | undefined> {
    if (this.describer) {
      return this.describer;
    }

    const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
    const visionModelId = config.get<string>("visionModel");

    if (visionModelId) {
      if (visionModelId === "api:endpoint") {
        const apiUrl = config.get<string>("visionProxy.apiUrl");
        const apiModelId = config.get<string>("visionProxy.apiModelId");
        const apiTimeoutMs = config.get<number>("visionProxy.timeoutMs");
        const apiMaxTokens = config.get<number>("visionProxy.maxTokens");

        if (apiUrl && apiModelId) {
          this.describer = new ApiEndpointVisionDescriber(
            {
              url: apiUrl,
              modelId: apiModelId,
              timeoutMs: apiTimeoutMs,
              maxTokens: apiMaxTokens,
            },
            this.context.secrets,
          );
          return this.describer;
        }
      } else {
        this.describer = new VSCodeLMVisionDescriber();
        return this.describer;
      }
    }

    this.describer = new VSCodeLMVisionDescriber();
    return this.describer;
  }

  /**
   * Reset the vision describer
   */
  reset(): void {
    this.describer = undefined;
  }

  /**
   * Dispose resources
   */
  dispose(): void {
    this.disposables.forEach((d) => d.dispose());
    this.disposables.length = 0;
  }
}

// ── Helper Functions ────────────────────────────────────────

/**
 * Get available vision language models
 */
export async function getVisionLanguageModelOptions(): Promise<VisionLanguageModelOption[]> {
  try {
    const models = await vscode.lm.selectChatModels();
    return models.map((m) => ({
      key: m.id,
      id: m.id,
      vendor: m.vendor,
      name: m.name,
      family: m.family ?? "",
      version: m.version ?? "",
      label: `${m.name} (${m.vendor})`,
      description: m.family ?? m.name,
    }));
  } catch (error) {
    logger.vision.error("Failed to get vision models:", error);
    return [];
  }
}

/**
 * Get the configured vision prompt
 */
export function getVisionPrompt(): string {
  const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
  return config.get<string>("visionPrompt") || DEFAULT_VISION_PROMPT;
}

/**
 * Get the configured max image size
 */
function getMaxImageSize(): number {
  const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
  return config.get<number>("maxImageSize") ?? 20 * 1024 * 1024;
}

// ── Image Resolution ────────────────────────────────────────

/**
 * Pre-computed message parts for a conversation (avoids redundant separation)
 */
interface ResolvedMessage {
  message: vscode.LanguageModelChatRequestMessage;
  parts: MessageParts;
}

/**
 * Separate message parts into image and text parts (single pass)
 */
function separateMessageParts(
  message: vscode.LanguageModelChatRequestMessage,
  maxImageSize: number,
): MessageParts {
  const imageParts: vscode.LanguageModelDataPart[] = [];
  const textParts: vscode.LanguageModelTextPart[] = [];

  const content = message.content as
    | readonly vscode.LanguageModelInputPart[]
    | undefined;

  if (!content) {
    return { imageParts, textParts };
  }

  for (const part of content) {
    if (part instanceof vscode.LanguageModelDataPart) {
      if (part.mimeType.startsWith("image/")) {
        if (part.data.length <= maxImageSize) {
          imageParts.push(part);
        } else {
          logger.vision.warn(
            `Image too large: ${part.data.length} bytes (max: ${maxImageSize})`,
          );
        }
      }
    } else if (part instanceof vscode.LanguageModelTextPart) {
      textParts.push(part);
    }
  }

  return { imageParts, textParts };
}

/**
 * Pre-separate all message parts in a single pass, reading maxImageSize once.
 */
function resolveAllMessageParts(
  messages: readonly vscode.LanguageModelChatRequestMessage[],
): ResolvedMessage[] {
  const maxImageSize = getMaxImageSize();
  return messages.map((message) => ({
    message,
    parts: separateMessageParts(message, maxImageSize),
  }));
}

/**
 * Resolve image messages in a conversation
 * Converts image parts to text descriptions using the vision proxy
 */
export async function resolveImageMessages(
  messages: readonly vscode.LanguageModelChatRequestMessage[],
  token: vscode.CancellationToken,
  visionService: VisionService,
): Promise<VisionResolutionResult> {
  const stats = createVisionResolutionStats();

  // Pre-separate all message parts once (reads config only once)
  const resolved = resolveAllMessageParts(messages);

  // Collect input stats from pre-computed parts
  for (const entry of resolved) {
    if (entry.parts.imageParts.length === 0) {
      continue;
    }
    stats.inputImageMessages += 1;
    stats.inputImageParts += entry.parts.imageParts.length;
  }

  if (stats.inputImageParts === 0) {
    return { messages, stats };
  }

  const currentImageMessageIndex = findCurrentImageMessageIndexFromResolved(resolved);
  if (currentImageMessageIndex === undefined) {
    return { messages, stats };
  }

  const describer = await visionService.get();
  if (!describer) {
    stats.unavailableImageMessages += 1;
    return {
      messages,
      stats,
      initialResponseNotice:
        "Vision proxy not configured. Image descriptions will be unavailable.",
    };
  }

  const result: vscode.LanguageModelChatRequestMessage[] = [];
  let visionModelId: string | undefined;
  let visionProxySource: VisionProxySource | undefined;
  let initialResponseNotice: string | undefined;

  for (const [index, entry] of resolved.entries()) {
    const { message, parts } = entry;

    if (parts.imageParts.length === 0) {
      result.push(message);
      continue;
    }

    if (index === currentImageMessageIndex) {
      stats.currentImageMessages += 1;

      try {
        const prompt = getVisionPrompt();
        const description = await describer.describe({
          prompt,
          images: parts.imageParts.map(toVisionImagePart),
          token,
        });

        if (description.length > 0) {
          stats.generatedImageMessages += 1;
          const visionText = createImageDescriptionText(description);
          const textContent = concatenateTextParts(parts.textParts);
          const combinedText = textContent
            ? `${textContent}\n\n${visionText}`
            : visionText;

          const content: (
            | vscode.LanguageModelTextPart
            | vscode.LanguageModelDataPart
          )[] = [new vscode.LanguageModelTextPart(combinedText)];
          const newMessage = vscode.LanguageModelChatMessage.User(content);
          result.push(newMessage);

          visionModelId = describer.id;
          visionProxySource = describer.source;
        } else {
          stats.failedImageMessages += 1;
          initialResponseNotice = "Vision proxy returned empty description.";
          result.push(message);
        }
      } catch (error) {
        stats.failedImageMessages += 1;
        initialResponseNotice = `Vision proxy failed: ${error instanceof Error ? error.message : String(error)}`;
        result.push(message);
      }

      stats.droppedImageParts += parts.imageParts.length;
    } else {
      stats.omittedImageMessages += 1;
      stats.droppedImageParts += parts.imageParts.length;
      result.push(message);
    }
  }

  return {
    messages: result,
    stats,
    visionModelId: visionModelId,
    visionProxySource: visionProxySource,
    initialResponseNotice,
  };
}

function createVisionResolutionStats(): VisionResolutionStats {
  return {
    inputImageParts: 0,
    inputImageMessages: 0,
    currentImageMessages: 0,
    generatedImageMessages: 0,
    unavailableImageMessages: 0,
    failedImageMessages: 0,
    omittedImageMessages: 0,
    droppedImageParts: 0,
  };
}

/**
 * Find the index of the current (latest) user message containing images,
 * using pre-computed resolved parts to avoid redundant separation.
 */
function findCurrentImageMessageIndexFromResolved(
  resolved: ResolvedMessage[],
): number | undefined {
  for (let index = resolved.length - 1; index >= 0; index--) {
    const entry = resolved[index];
    if (entry.message.role === vscode.LanguageModelChatMessageRole.Assistant) {
      return undefined;
    }
    if (entry.message.role !== vscode.LanguageModelChatMessageRole.User) {
      continue;
    }
    if (entry.parts.imageParts.length > 0) {
      return index;
    }
  }
  return undefined;
}

function concatenateTextParts(parts: vscode.LanguageModelTextPart[]): string {
  return parts.map((p) => p.value).join("");
}

function toVisionImagePart(part: vscode.LanguageModelDataPart): VisionImagePart {
  return {
    mimeType: part.mimeType,
    data: part.data,
  };
}

function createImageDescriptionText(description: string): string {
  return IMAGE_DESCRIPTION_PREFIX + description + IMAGE_DESCRIPTION_SUFFIX;
}
