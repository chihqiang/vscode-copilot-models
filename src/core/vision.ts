/**
 * Vision proxy module - Image description for non-vision models
 *
 * Provides vision proxy functionality to describe images using
 * VS Code Language Models or custom API endpoints.
 */

import vscode from "vscode";
import { logger } from "./logger";
import { isImageMime, toDataUrl } from "./bytes";
import { CONFIG_SECTION } from "./models";
import {
  getConfig,
  getMaxImageSize,
  settingKey,
  SETTING_VISION_MODEL,
  SETTING_VISION_PROMPT,
  SETTING_VISION_PROXY_API_MODEL_ID,
  SETTING_VISION_PROXY_API_URL,
  SETTING_VISION_PROXY_MAX_TOKENS,
  SETTING_VISION_PROXY_TIMEOUT_MS,
} from "./settings";
import { sanitizeUrl } from "./sanitize";

// ── Constants ───────────────────────────────────────────────

/** Prefix for image description text */
export const IMAGE_DESCRIPTION_PREFIX = "[Image: ";

/** Suffix for image description text */
export const IMAGE_DESCRIPTION_SUFFIX = "]";

/** Text when image description is unavailable */
export const IMAGE_DESCRIPTION_UNAVAILABLE = "[Image: description unavailable]";

/** Default vision prompt */
export const DEFAULT_VISION_PROMPT = `Describe all image attachments in this message.

If there is one image, describe it directly.
If there are multiple images:
1. Describe each image separately, preserving their order.
2. Then provide a combined description explaining the overall context and relationships across the images.

Return one concise factual description suitable for inserting into a text-only chat prompt. Include visible text, objects, UI elements, people, and relevant context. Do not invent details.`;

/** SecretStorage key for vision proxy API key */
export const VISION_PROXY_API_KEY_SECRET = `${CONFIG_SECTION}.visionProxy.apiKey`;

/**
 * Why this extension needs another extension's language model.
 *
 * VS Code gates one extension using another's models behind an approval the
 * user has to give, and renders this string there as `Justification: <text>`.
 * The vision describer used to send no options at all, so the prompt asked for
 * access without saying what for.
 */
export const VISION_MODEL_JUSTIFICATION =
  "Copilot Models uses this model to describe images, so that models without " +
  "image input can still answer questions about them.";

/**
 * How to recover from a refused model.
 *
 * Names the command rather than a menu path: it is the stable, greppable
 * identifier, whereas the surrounding UI moves between releases.
 */
const VISION_ACCESS_HINT =
  'Run "Manage Language Model Access" ' +
  "(workbench.action.chat.manageLanguageModelAuthentication) to allow it, or " +
  'pick a different model with "Copilot Models: Set Vision Model".';

/** The message for a vision model this extension is not allowed to use. */
function visionModelDeniedMessage(model: {
  id: string;
  vendor: string;
}): string {
  return (
    `VS Code has not allowed Copilot Models to use the vision model ` +
    `"${model.id}" from ${model.vendor}. ${VISION_ACCESS_HINT}`
  );
}

/**
 * The refusal message for a model this extension may not use, or `undefined`.
 *
 * `canSendRequest` only reports a decision the user already made — it never
 * prompts — so `undefined` ("never asked") has to be treated as usable,
 * leaving `sendRequest` to raise the approval prompt.
 */
export function visionModelRefusal(
  accessInfo: vscode.LanguageModelAccessInformation | undefined,
  model: vscode.LanguageModelChat,
): string | undefined {
  if (accessInfo?.canSendRequest(model) !== false) {
    return undefined;
  }
  return visionModelDeniedMessage(model);
}

/**
 * An actionable message for a refusal by another extension's model, or
 * `undefined` when the failure has some other cause.
 *
 * The refusal arrives as a `LanguageModelError` rather than as a transport
 * failure, so without this the user only sees the generic
 * "Vision proxy failed: ..." notice and has nothing to act on.
 */
export function visionModelAccessError(error: unknown): string | undefined {
  if (!(error instanceof vscode.LanguageModelError)) {
    return undefined;
  }
  const { NoPermissions, Blocked } = vscode.LanguageModelError;
  if (error.code !== NoPermissions.name && error.code !== Blocked.name) {
    return undefined;
  }
  return `${error.message} ${VISION_ACCESS_HINT}`;
}

/**
 * Sentinel stored in `visionModel` when the user picks "Custom API Endpoint".
 * Shared with the wizard so the value is not duplicated as a bare literal.
 */
export const VISION_API_ENDPOINT_ID = "api:endpoint";

/** Where to go after picking a vision model that cannot see images. */
const VISION_MODEL_HINT =
  'Pick a model with image support via "Copilot Models: Set Vision Model".';

/**
 * Whether a model is known to accept image input, or `undefined` when the
 * editor does not say.
 *
 * The value mirrors `capabilities.imageInput` as reported by whichever
 * provider serves the model. `undefined` is not "no": on a VS Code that does
 * not carry the field at all, refusing every model would leave the proxy
 * unusable, so callers have to distinguish the two.
 */
export function canAcceptImages(
  model: vscode.LanguageModelChat,
): boolean | undefined {
  const declared = model.capabilities?.supportsImageToText;
  return typeof declared === "boolean" ? declared : undefined;
}

/**
 * Keep only the models usable for describing an image.
 *
 * A description is a model call that carries the image, so a model without
 * image input cannot perform one. Treating `capabilities` as missing rather
 * than false keeps older editors working: only when *no* model states anything
 * is the list left untouched.
 */
export function selectVisionCapable(
  models: readonly vscode.LanguageModelChat[],
): vscode.LanguageModelChat[] {
  const known = models.some((m) => canAcceptImages(m) !== undefined);
  return known
    ? models.filter((m) => canAcceptImages(m) === true)
    : [...models];
}

/**
 * Message for a request that must be described but cannot be.
 *
 * Reachable when a model without image input was configured as the vision
 * model on an editor too old to report `capabilities` — the check that would
 * have refused it has nothing to go on. Saying so is better than sending the
 * image to a provider that will reject it, or than the infinite loop this
 * replaces.
 */
export function visionModelNeedsImageInputMessage(modelId: string): string {
  return (
    `"${modelId}" does not accept image input, so it cannot describe an ` +
    `image. ${VISION_MODEL_HINT}`
  );
}

/**
 * Models whose image description is currently in flight, and how many calls
 * are using each.
 *
 * The describer calls back into this extension whenever the model it picked is
 * one of ours, and that nested request contains the image — so without this it
 * would be proxied again, and again. Keyed by model id, which is what the
 * nested request carries: unrelated concurrent requests are unaffected, and
 * the one overlap it does catch is two simultaneous descriptions through the
 * same model, where the second is refused instead of looping.
 */
const descriptionsInFlight = new Map<string, number>();

function beginImageDescription(modelId: string): void {
  descriptionsInFlight.set(
    modelId,
    (descriptionsInFlight.get(modelId) ?? 0) + 1,
  );
}

function endImageDescription(modelId: string): void {
  const remaining = (descriptionsInFlight.get(modelId) ?? 1) - 1;
  if (remaining > 0) {
    descriptionsInFlight.set(modelId, remaining);
  } else {
    descriptionsInFlight.delete(modelId);
  }
}

/**
 * Whether any message carries an image part.
 *
 * Separate from {@link resolveImageMessages} so a caller can ask the question
 * without building the statistics and part cache that the resolution needs.
 */
export function containsImageParts(
  messages: readonly vscode.LanguageModelChatRequestMessage[],
): boolean {
  return messages.some((message) =>
    (message.content as readonly unknown[]).some(
      (part) =>
        part instanceof vscode.LanguageModelDataPart &&
        isImageMime(part.mimeType),
    ),
  );
}

/**
 * Whether this extension is currently describing an image with `modelId`.
 *
 * A request that arrives for such a model is the describer's own call coming
 * back, not a new user request, and must not be proxied again.
 */
export function isDescribingWith(modelId: string): boolean {
  return descriptionsInFlight.has(modelId);
}

/**
 * Store the vision proxy API key.
 *
 * This was previously read-only: `ApiEndpointVisionDescriber` looked the key
 * up in SecretStorage, but nothing ever wrote it, so every authenticated
 * custom vision endpoint failed with "API key not configured for vision
 * proxy".
 */
export async function storeVisionProxyApiKey(
  secretStorage: vscode.SecretStorage,
  apiKey: string,
): Promise<void> {
  await secretStorage.store(VISION_PROXY_API_KEY_SECRET, apiKey.trim());
}

/** Remove the stored vision proxy API key, if any. */
export async function clearVisionProxyApiKey(
  secretStorage: vscode.SecretStorage,
): Promise<void> {
  try {
    await secretStorage.delete(VISION_PROXY_API_KEY_SECRET);
  } catch {
    // may not exist
  }
}

/** Whether a vision proxy API key is currently stored. */
export async function hasVisionProxyApiKey(
  secretStorage: vscode.SecretStorage,
): Promise<boolean> {
  const key = await secretStorage.get(VISION_PROXY_API_KEY_SECRET);
  return typeof key === "string" && key.length > 0;
}

/**
 * Normalize an OpenAI-compatible endpoint URL into the chat completions path.
 *
 * The settings description and README tell users an OpenAI-compatible
 * `/chat/completions` endpoint is required, while the wizard placeholder shows
 * a base URL — so both forms are entered in practice. Appending the path
 * unconditionally turned the first form into `.../chat/completions/chat/completions`.
 */
export function resolveVisionCompletionUrl(url: string): string {
  const trimmed = url.trim().replace(/\/+$/, "");
  return trimmed.endsWith("/chat/completions")
    ? trimmed
    : `${trimmed}/chat/completions`;
}

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
  /**
   * Data parts that are not images (JSON, plain text).
   *
   * Kept separate because the vision proxy rebuilds a message around its
   * description and used to carry over only text parts — so a JSON payload in
   * the same message disappeared on the way. They are not sent to the vision
   * model; the rebuilt message hands them back to `convertMessages`.
   */
  otherDataParts: vscode.LanguageModelDataPart[];
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
  private readonly accessInfo:
    | vscode.LanguageModelAccessInformation
    | undefined;

  constructor(accessInfo?: vscode.LanguageModelAccessInformation) {
    const config = getConfig();
    this.accessInfo = accessInfo;
    this.visionModelId = config.get<string>(SETTING_VISION_MODEL);
    this.visionPrompt =
      config.get<string>(SETTING_VISION_PROMPT) || DEFAULT_VISION_PROMPT;
    this.id = this.visionModelId
      ? `vscode-lm:${this.visionModelId}`
      : "vscode-lm:auto";
  }

  async describe(request: VisionDescriptionRequest): Promise<string> {
    const prompt = request.prompt || this.visionPrompt;

    try {
      const model = await this.selectVisionModel();

      if (!model) {
        logger.vision.warn(
          this.visionModelId
            ? `No vision model matched "${this.visionModelId}", falling back to auto-detect failed`
            : "No vision models available",
        );
        return "";
      }

      logger.vision.info(
        `Using vision model: ${model.id} (${model.family}/${model.name})`,
      );
      this.assertUsable(model);

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

      // Publish what is being described with before the call: the model may be
      // one of ours, in which case this request comes straight back and has to
      // be recognised rather than proxied a second time.
      beginImageDescription(model.id);
      let description = "";
      try {
        const response = await model.sendRequest(
          messages,
          { justification: VISION_MODEL_JUSTIFICATION },
          request.token,
        );

        for await (const part of response.text) {
          description += part;
        }
      } finally {
        endImageDescription(model.id);
      }

      logger.vision.debug(
        `Vision description generated: ${description.length} chars`,
      );

      return description.trim();
    } catch (error) {
      const accessError = visionModelAccessError(error);
      if (accessError) {
        logger.vision.error(accessError);
        throw new Error(accessError);
      }
      logger.vision.error("Failed to generate vision description:", error);
      throw error;
    }
  }

  /**
   * Fail early, and with advice, when the user has refused this extension.
   */
  private assertUsable(model: vscode.LanguageModelChat): void {
    const refusal = visionModelRefusal(this.accessInfo, model);
    if (refusal) {
      throw new Error(refusal);
    }
  }

  /**
   * Resolve the language model used for descriptions.
   *
   * The stored `visionModel` value is written by the wizard as a model **id**
   * (`LanguageModelChat.id`), but settings can also carry a model **family**
   * entered by hand. The previous implementation matched every value against
   * `family` only, so models picked from the wizard list never matched and
   * every description came back empty. Try the id first, then the family.
   *
   * Every branch filters on image support, including auto-detect: a model that
   * cannot see the image cannot describe it, and when it is one of ours the
   * attempt comes back here as a nested request.
   */
  private async selectVisionModel(): Promise<
    vscode.LanguageModelChat | undefined
  > {
    if (!this.visionModelId) {
      return selectVisionCapable(await vscode.lm.selectChatModels())[0];
    }

    const byId = selectVisionCapable(
      await vscode.lm.selectChatModels({ id: this.visionModelId }),
    );
    if (byId.length > 0) {
      return byId[0];
    }

    const byFamily = selectVisionCapable(
      await vscode.lm.selectChatModels({ family: this.visionModelId }),
    );
    return byFamily[0];
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
          url: toDataUrl(img.data, img.mimeType),
        },
      }));

      const requestBody = {
        model: this.config.modelId,
        messages: [
          {
            role: "user",
            content: [{ type: "text", text: request.prompt }, ...imageContents],
          },
        ],
        max_tokens: this.config.maxTokens ?? 1024,
      };

      logger.vision.debug(
        `Sending vision request to ${sanitizeUrl(this.config.url)}, model: ${this.config.modelId}, timeout: ${timeoutMs}ms`,
      );

      const response = await fetch(
        resolveVisionCompletionUrl(this.config.url),
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify(requestBody),
          signal: controller.signal,
        },
      );

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
 * Vision settings that are captured when a describer is constructed.
 *
 * `VisionService` caches the describer it builds, so a change to any of these
 * must reset that cache. `visionProxy.timeoutMs` / `visionProxy.maxTokens`
 * used to be missing from this list, which made editing them a no-op until
 * the window was reloaded.
 */
export function visionAffectingConfigKeys(): string[] {
  return [
    settingKey(SETTING_VISION_MODEL),
    settingKey(SETTING_VISION_PROMPT),
    settingKey(SETTING_VISION_PROXY_API_URL),
    settingKey(SETTING_VISION_PROXY_API_MODEL_ID),
    settingKey(SETTING_VISION_PROXY_TIMEOUT_MS),
    settingKey(SETTING_VISION_PROXY_MAX_TOKENS),
  ];
}

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
          visionAffectingConfigKeys().some((key) => e.affectsConfiguration(key))
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
   * Get the current vision describer, or `undefined` when the configured proxy
   * cannot be built.
   *
   * The `undefined` return is reserved for an incomplete custom endpoint.
   * Previously that case fell through to VS Code LM auto-detect, so a user who
   * selected "Custom API Endpoint" without filling in the URL or model ID
   * silently got auto-detected descriptions while believing their own endpoint
   * was in use — and the caller's "not configured" notice was unreachable.
   */
  async get(): Promise<VisionDescriber | undefined> {
    if (this.describer) {
      return this.describer;
    }

    const config = getConfig();
    const visionModelId = config.get<string>("visionModel");

    if (visionModelId === VISION_API_ENDPOINT_ID) {
      const apiUrl = config.get<string>("visionProxy.apiUrl");
      const apiModelId = config.get<string>("visionProxy.apiModelId");

      if (!apiUrl || !apiModelId) {
        logger.vision.warn(
          `Vision proxy is set to a custom endpoint but its configuration is incomplete ` +
            `(apiUrl=${apiUrl ? "set" : "missing"}, apiModelId=${apiModelId ? "set" : "missing"}); ` +
            `image descriptions are disabled`,
        );
        return undefined;
      }

      this.describer = new ApiEndpointVisionDescriber(
        {
          url: apiUrl,
          modelId: apiModelId,
          timeoutMs: config.get<number>(SETTING_VISION_PROXY_TIMEOUT_MS),
          maxTokens: config.get<number>(SETTING_VISION_PROXY_MAX_TOKENS),
        },
        this.context.secrets,
      );
      return this.describer;
    }

    // No explicit model id means "auto-detect" (the documented default).
    this.describer = new VSCodeLMVisionDescriber(
      this.context.languageModelAccessInformation,
    );
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

/**
 * Shared vision services, one per extension context.
 *
 * Every chat provider needs a `VisionService`, but the service only reads
 * global settings — building one per provider registered the same two
 * configuration/secret listeners three times over and kept a separate
 * describer cache in each. Keyed by context so a test that uses its own
 * context still gets an isolated instance.
 */
const sharedVisionServices = new WeakMap<
  vscode.ExtensionContext,
  VisionService
>();

/**
 * Get the `VisionService` for an extension context, creating it on first use.
 *
 * The service is owned by the extension (`context.subscriptions`), not by the
 * provider that happened to request it first: disposing a single provider —
 * which happens whenever a provider is disabled — must not tear down state the
 * other providers still use.
 */
export function getVisionService(
  context: vscode.ExtensionContext,
): VisionService {
  let service = sharedVisionServices.get(context);
  if (!service) {
    service = new VisionService(context);
    sharedVisionServices.set(context, service);
    context.subscriptions?.push(service);
  }
  return service;
}

// ── Helper Functions ────────────────────────────────────────

/**
 * Get the models offered as vision proxies.
 *
 * Two things are filtered out. Models without image input, because describing
 * an image is a call that carries the image — offering one produced a
 * description request that either failed or, when the model was one of ours,
 * came back as another description request. And a repeated vendor/id pair:
 * today one router provider serves every model, so each appears once, but the
 * three per-provider vendors are declared in the manifest and would each
 * contribute the same ids if they were registered too.
 */
export async function getVisionLanguageModelOptions(): Promise<
  VisionLanguageModelOption[]
> {
  try {
    const models = selectVisionCapable(await vscode.lm.selectChatModels());

    const seen = new Set<string>();
    const options: VisionLanguageModelOption[] = [];
    for (const m of models) {
      const key = `${m.vendor}/${m.id}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      options.push({
        key: m.id,
        id: m.id,
        vendor: m.vendor,
        name: m.name,
        family: m.family ?? "",
        version: m.version ?? "",
        label: `${m.name} (${m.vendor})`,
        description: m.family ?? m.name,
      });
    }
    return options;
  } catch (error) {
    logger.vision.error("Failed to get vision models:", error);
    return [];
  }
}

/**
 * Get the configured vision prompt
 */
export function getVisionPrompt(): string {
  const config = getConfig();
  return config.get<string>(SETTING_VISION_PROMPT) || DEFAULT_VISION_PROMPT;
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
  const otherDataParts: vscode.LanguageModelDataPart[] = [];

  const content = message.content as
    | readonly vscode.LanguageModelInputPart[]
    | undefined;

  if (!content) {
    return { imageParts, textParts, otherDataParts };
  }

  for (const part of content) {
    if (part instanceof vscode.LanguageModelDataPart) {
      if (isImageMime(part.mimeType)) {
        if (part.data.length <= maxImageSize) {
          imageParts.push(part);
        } else {
          logger.vision.warn(
            `Image too large: ${part.data.length} bytes (max: ${maxImageSize})`,
          );
        }
      } else {
        otherDataParts.push(part);
      }
    } else if (part instanceof vscode.LanguageModelTextPart) {
      textParts.push(part);
    }
  }

  return { imageParts, textParts, otherDataParts };
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
 * Options for {@link resolveImageMessages}.
 */
export interface ResolveImageMessagesOptions {
  /**
   * Set when the target model accepts image input natively. The vision proxy
   * is then bypassed entirely: replacing a real image with a text description
   * throws away visual detail the model could have used directly.
   */
  skipVisionProxy?: boolean | undefined;
}

/**
 * Resolve image messages in a conversation
 * Converts image parts to text descriptions using the vision proxy
 */
export async function resolveImageMessages(
  messages: readonly vscode.LanguageModelChatRequestMessage[],
  token: vscode.CancellationToken,
  visionService: VisionService,
  options?: ResolveImageMessagesOptions,
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

  if (options?.skipVisionProxy) {
    logger.vision.debug(
      "Model accepts image input natively, bypassing vision proxy",
    );
    return { messages, stats };
  }

  const currentImageMessageIndex =
    findCurrentImageMessageIndexFromResolved(resolved);

  // Only the current turn's images are described, so the describer is only
  // needed when there is one to describe. This used to return early when the
  // images all belonged to earlier turns, which sent those images through
  // untouched — to a model the proxy exists to keep them away from.
  const describer =
    currentImageMessageIndex === undefined
      ? undefined
      : await visionService.get();

  if (currentImageMessageIndex !== undefined && !describer) {
    stats.unavailableImageMessages += 1;
    return {
      // Nothing could be described, so nothing may be forwarded either.
      messages: replaceImagesInAllMessages(resolved),
      stats,
      initialResponseNotice:
        "Vision proxy not configured. Image descriptions will be unavailable.",
    };
  }

  const result: vscode.LanguageModelChatRequestMessage[] = [];
  let visionModelId: string | undefined;
  let visionProxySource: VisionProxySource | undefined;
  let initialResponseNotice: string | undefined;

  // Resolve the prompt once rather than re-reading configuration inside the
  // per-message loop below.
  const visionPrompt = getVisionPrompt();

  for (const [index, entry] of resolved.entries()) {
    const { message, parts } = entry;

    if (parts.imageParts.length === 0) {
      result.push(message);
      continue;
    }

    if (describer && index === currentImageMessageIndex) {
      stats.currentImageMessages += 1;

      try {
        const description = await describer.describe({
          prompt: visionPrompt,
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
          )[] = [
            new vscode.LanguageModelTextPart(combinedText),
            ...parts.otherDataParts,
          ];
          // Keep the original name: rebuilding a message must not drop what
          // the caller put there.
          const newMessage = new vscode.LanguageModelChatMessage(
            message.role,
            content,
            message.name,
          );
          result.push(newMessage);

          visionModelId = describer.id;
          visionProxySource = describer.source;
        } else {
          stats.failedImageMessages += 1;
          initialResponseNotice = "Vision proxy returned empty description.";
          result.push(replaceImagesWithPlaceholder(message));
        }
      } catch (error) {
        stats.failedImageMessages += 1;
        initialResponseNotice = `Vision proxy failed: ${error instanceof Error ? error.message : String(error)}`;
        result.push(replaceImagesWithPlaceholder(message));
      }

      stats.droppedImageParts += parts.imageParts.length;
    } else {
      stats.omittedImageMessages += 1;
      stats.droppedImageParts += parts.imageParts.length;
      result.push(replaceImagesWithPlaceholder(message));
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

function toVisionImagePart(
  part: vscode.LanguageModelDataPart,
): VisionImagePart {
  return {
    mimeType: part.mimeType,
    data: part.data,
  };
}

function createImageDescriptionText(description: string): string {
  return IMAGE_DESCRIPTION_PREFIX + description + IMAGE_DESCRIPTION_SUFFIX;
}

/**
 * Rebuild a message with its image parts replaced by a placeholder.
 *
 * A model without image input must never receive image parts — that is the
 * whole point of the proxy. This covers the images it did not describe: an
 * empty description, a describer that threw, a describer that is not
 * configured, and images from earlier turns, which are not described again.
 *
 * The role is preserved and every non-image part is kept, so surrounding text
 * and tool calls survive. Callers must have established that the message holds
 * at least one image part; otherwise the message is returned unchanged, since
 * rebuilding it would only risk dropping parts for no reason.
 */
function replaceImagesWithPlaceholder(
  message: vscode.LanguageModelChatRequestMessage,
): vscode.LanguageModelChatRequestMessage {
  const content = message.content as readonly vscode.LanguageModelInputPart[];

  const hasImage = content.some(
    (part) =>
      part instanceof vscode.LanguageModelDataPart &&
      isImageMime(part.mimeType),
  );
  if (!hasImage) {
    return message;
  }

  const replaced = content.map((part) =>
    part instanceof vscode.LanguageModelDataPart && isImageMime(part.mimeType)
      ? new vscode.LanguageModelTextPart(IMAGE_DESCRIPTION_UNAVAILABLE)
      : part,
  );

  // Keep the original name as well as the role: rebuilding the message must
  // not drop anything the caller still relies on.
  return new vscode.LanguageModelChatMessage(
    message.role,
    replaced,
    message.name,
  );
}

/** Apply {@link replaceImagesWithPlaceholder} where a message has images. */
function replaceImagesInAllMessages(
  resolved: readonly ResolvedMessage[],
): vscode.LanguageModelChatRequestMessage[] {
  return resolved.map((entry) =>
    entry.parts.imageParts.length > 0
      ? replaceImagesWithPlaceholder(entry.message)
      : entry.message,
  );
}
