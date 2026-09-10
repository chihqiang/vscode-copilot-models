/**
 * Base Chat Provider - Common logic for vscode.LanguageModelChatProvider
 */

import vscode from "vscode";
import {
  generateRequestId,
  getLogContext,
  logger,
  withLogContext,
  type LogContext,
} from "./logger";
import { isImageMime, toDataUrl } from "./bytes";
import { ApiError, CancelledError, TimeoutError } from "./errors";
import {
  ApiMessage,
  ApiRequest,
  ApiTool,
  ApiToolCall,
  ContentPart,
  IApiClient,
  StreamCallbacks,
} from "./client";
import { CONFIG_SECTION, ModelDefinition } from "./models";
import {
  getMaxImageSize,
  SETTING_MAX_RETRIES,
  SETTING_MODEL_ID_OVERRIDES,
  SETTING_TIMEOUT_MS,
} from "./settings";
import { sanitizeUrl } from "./sanitize";
import { IModelProvider } from "./model-provider";
import { Tokenizer } from "./tokenizer";
import {
  TokenPlan,
  TOKEN_PLAN_SECRET_PREFIX,
  type PlanOverride,
} from "./token-plan";
import {
  VisionService,
  getVisionService,
  resolveImageMessages,
} from "./vision";

/**
 * Chat Provider interface (simplified, for type checking)
 * Extends VS Code LanguageModelChatProvider with additional methods
 */
export interface IChatProvider<
  T extends vscode.LanguageModelChatInformation =
    vscode.LanguageModelChatInformation,
> extends vscode.LanguageModelChatProvider<T> {
  /** Refresh model picker */
  refreshModelPicker(): void;
  /** Prepare for deactivation */
  prepareForDeactivate(): Promise<void>;
  /** Dispose resources */
  dispose(): void;
}

/**
 * Thinking mode effort level
 */
export type ThinkingEffort = "none" | "low" | "high" | "max";

/**
 * Model configuration options
 */
export type ModelConfigurationOptions =
  vscode.ProvideLanguageModelChatResponseOptions & {
    readonly modelConfiguration?: Record<string, unknown>;
    readonly configuration?: Record<string, unknown>;
  };

/**
 * Model picker information
 */
export type ModelPickerChatInformation = vscode.LanguageModelChatInformation & {
  readonly isUserSelectable: boolean;
  readonly statusIcon?: vscode.ThemeIcon;
  readonly configurationSchema?: {
    properties: Record<string, unknown>;
  };
};

// Re-export PlanOverride for backward compatibility
export type { PlanOverride } from "./token-plan";

/**
 * Prepared chat request
 */
export interface PreparedChatRequest {
  request: ApiRequest;
  modelDefinition: ModelDefinition | undefined;
  apiMessages: ApiMessage[];
  tools?: ApiTool[];
  isThinkingModel: boolean;
  thinkingEffort: ThinkingEffort;
  planOverride?: PlanOverride | undefined;
}

/**
 * Configuration keys that change how an API client is constructed.
 *
 * Clients are cached per provider (see `BaseChatProvider.clientCache`) and
 * capture timeout/retry settings at construction time, so a change to any of
 * these must invalidate the cache — otherwise editing `timeoutMs` or
 * `maxRetries` has no effect until the window is reloaded.
 */
export function clientAffectingConfigKeys(
  configSection: string,
  providerId: string,
): string[] {
  return [
    `${configSection}.${providerId}.baseUrl`,
    `${configSection}.${SETTING_MODEL_ID_OVERRIDES}`,
    `${configSection}.${SETTING_TIMEOUT_MS}`,
    `${configSection}.${SETTING_MAX_RETRIES}`,
  ];
}

/**
 * The text a tool result contributes to the request.
 *
 * Shared by `convertMessages` (which sends it) and `extractTextFromMessage`
 * (which counts it), so the two cannot drift apart and make the reported token
 * count disagree with what the provider receives.
 */
function toolResultContentString(
  part: vscode.LanguageModelToolResultPart,
): string {
  const textParts: string[] = [];
  let binaryParts = 0;
  for (const item of part.content) {
    if (item instanceof vscode.LanguageModelTextPart) {
      textParts.push(item.value);
    } else if (item instanceof vscode.LanguageModelDataPart) {
      binaryParts++;
    }
  }

  const toolText = textParts.join("");
  if (toolText) {
    return toolText;
  }
  // Never serialize binary data parts into the request — that would bloat the
  // payload with a huge JSON byte map. Count the placeholder instead, which is
  // what the provider actually sees.
  return binaryParts > 0
    ? `[Tool result contains ${binaryParts} binary data part(s), omitted]`
    : JSON.stringify(part.content);
}

/**
 * Base Chat Provider implementation
 */
export abstract class BaseChatProvider
  implements
    IChatProvider<vscode.LanguageModelChatInformation>,
    vscode.Disposable
{
  protected readonly globalStorageUri: vscode.Uri;
  protected readonly onDidChangeLanguageModelChatInformationEmitter =
    new vscode.EventEmitter<void>();
  protected readonly providerId: string;
  protected readonly providerName: string;
  protected readonly configSection: string;
  protected readonly supportsThinking: boolean;
  protected readonly visionService: VisionService;
  protected isActive = true;
  private disposables: vscode.Disposable[] = [];

  /**
   * Cached API clients, keyed by `baseUrl::apiKey`. Exposed to subclasses and
   * tests so cache invalidation (config / secret changes) is verifiable.
   */
  protected readonly clientCache = new Map<string, IApiClient>();

  /** Cached API key presence, invalidated on secret change */
  private hasApiKeyCache: boolean | undefined;

  readonly onDidChangeLanguageModelChatInformation =
    this.onDidChangeLanguageModelChatInformationEmitter.event;

  // ── Static helpers ───────────────────────────────

  private static isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null;
  }

  private static reportThinkingPart(
    progress: vscode.Progress<vscode.LanguageModelResponsePart>,
    text: string,
  ): void {
    progress.report(new vscode.LanguageModelThinkingPart(text));
  }

  static buildThinkingEffortSchema() {
    return {
      properties: {
        reasoningEffort: {
          type: "string",
          title: "Thinking Effort",
          enum: ["none", "low", "high", "max"],
          enumItemLabels: ["None", "Low", "High", "Max"],
          enumDescriptions: [
            "Disable thinking mode",
            "Low reasoning effort",
            "High reasoning effort",
            "Maximum reasoning effort",
          ],
          default: "high",
          group: "navigation",
        },
      },
    };
  }

  constructor(
    protected readonly context: vscode.ExtensionContext,
    protected readonly modelProvider: IModelProvider,
  ) {
    this.globalStorageUri = context.globalStorageUri;
    this.providerId = modelProvider.id;
    this.providerName = modelProvider.config.vendorName;
    this.configSection = this.getConfigSection();
    this.supportsThinking = this.getSupportsThinking();
    this.visionService = getVisionService(context);

    logger.provider.debug(`[${this.providerId}] ChatProvider initialized`);

    // The vision service is intentionally absent here: it is shared across
    // providers and owned by the extension context, so disposing this provider
    // must not dispose it.
    this.disposables.push(
      this.onDidChangeLanguageModelChatInformationEmitter,
      vscode.workspace.onDidChangeConfiguration((e) => {
        this.onConfigurationChanged(e);
      }),
      context.secrets.onDidChange((e) => {
        this.onSecretsChanged(e);
      }),
    );
  }

  /**
   * Get configuration section name (subclass can override)
   */
  protected getConfigSection(): string {
    return CONFIG_SECTION;
  }

  /**
   * Get whether thinking mode is supported (subclass can override)
   */
  protected getSupportsThinking(): boolean {
    return false;
  }

  /**
   * Dispose resources
   */
  dispose(): void {
    logger.provider.debug(`[${this.providerId}] Disposing ChatProvider...`);
    this.isActive = false;
    this.clientCache.clear();
    this.disposables.forEach((d) => d.dispose());
    this.disposables = [];
  }

  /**
   * Called on configuration change
   */
  protected onConfigurationChanged(e: vscode.ConfigurationChangeEvent): void {
    if (this.isActive && this.affectsConfiguration(e)) {
      logger.config.debug(
        `[${this.providerId}] Configuration affects this provider, refreshing...`,
      );
      this.clientCache.clear();
      this.onDidChangeLanguageModelChatInformationEmitter.fire();
    }
  }

  /**
   * Check if configuration affects this provider (subclass can override)
   */
  protected affectsConfiguration(e: vscode.ConfigurationChangeEvent): boolean {
    return clientAffectingConfigKeys(this.configSection, this.providerId).some(
      (key) => e.affectsConfiguration(key),
    );
  }

  /**
   * Called on secret change
   */
  protected onSecretsChanged(e: vscode.SecretStorageChangeEvent): void {
    logger.auth.debug(`[${this.providerId}] Secret changed: ${e.key}`);
    if (this.isActive && this.affectsSecretKey(e)) {
      logger.auth.debug(
        `[${this.providerId}] Secret affects this provider, refreshing...`,
      );
      this.hasApiKeyCache = undefined;
      // The cache key embeds the API key, so a rotated key would otherwise
      // leave the previous client — and its plaintext key — cached for the
      // lifetime of the provider.
      this.clientCache.clear();
      this.onDidChangeLanguageModelChatInformationEmitter.fire();
    }
    if (this.isActive && e.key.startsWith(TOKEN_PLAN_SECRET_PREFIX)) {
      logger.auth.debug(
        `[${this.providerId}] Token plan secret changed, refreshing...`,
      );
      this.onDidChangeLanguageModelChatInformationEmitter.fire();
    }
  }

  /**
   * Check if secret affects this provider (subclass can override)
   */
  protected affectsSecretKey(e: vscode.SecretStorageChangeEvent): boolean {
    return e.key === this.modelProvider.config.apiKeySecretKey;
  }

  /**
   * Get model picker information
   */
  async provideLanguageModelChatInformation(
    _options: vscode.PrepareLanguageModelChatModelOptions,
    _token: vscode.CancellationToken,
  ): Promise<vscode.LanguageModelChatInformation[]> {
    if (!this.isActive) {
      logger.provider.debug(
        `[${this.providerId}] Provider is not active, returning empty`,
      );
      return [];
    }

    if (this.hasApiKeyCache === undefined) {
      this.hasApiKeyCache = await this.modelProvider.hasApiKey();
    }
    const hasApiKey = this.hasApiKeyCache;
    const planManager = TokenPlan.getInstance();
    const planModelIds = planManager.getPlanModelIds();
    const models = this.modelProvider.getModels();
    logger.provider.info(
      `[${this.providerId}] Providing model information, count: ${models.length}, hasApiKey: ${hasApiKey}, planModels: ${planModelIds.size}`,
    );

    return models.map((model) =>
      this.toChatInfo(
        model,
        hasApiKey || planModelIds.has(model.id),
        planModelIds.has(model.id),
      ),
    );
  }

  /**
   * Convert model definition to chat info (subclass can override)
   */
  protected toChatInfo(
    model: ModelDefinition,
    hasApiKey: boolean,
    hasPlan = false,
  ): ModelPickerChatInformation {
    const selectable = hasApiKey || hasPlan;
    logger.provider.debug(
      `[${this.providerId}] Converting model to chat info: ${model.id}, hasApiKey: ${hasApiKey}, hasPlan: ${hasPlan}, selectable: ${selectable}`,
    );
    return {
      id: model.id,
      name: model.name,
      family: model.family,
      version: model.version,
      detail: selectable ? model.detail : "API key required",
      tooltip: hasPlan
        ? "Covered by token plan"
        : selectable
          ? ""
          : "Please configure API key",
      statusIcon: new vscode.ThemeIcon(selectable ? "check" : "warning"),
      maxInputTokens: model.maxInputTokens,
      maxOutputTokens: model.maxOutputTokens,
      isUserSelectable: selectable,
      capabilities: {
        toolCalling: model.capabilities.toolCalling,
        imageInput: model.capabilities.imageInput,
      },
      ...(this.supportsThinking && model.capabilities.thinking
        ? { configurationSchema: BaseChatProvider.buildThinkingEffortSchema() }
        : {}),
    };
  }

  /**
   * Find the model definition backing a VS Code model info, by model ID.
   */
  protected findModelDefinition(modelId: string): ModelDefinition | undefined {
    return this.modelProvider.getModels().find((m) => m.id === modelId);
  }

  /**
   * Prepare chat request
   */
  protected async prepareChatRequest(
    modelInfo: vscode.LanguageModelChatInformation,
    messages: readonly vscode.LanguageModelChatRequestMessage[],
    options: vscode.ProvideLanguageModelChatResponseOptions,
  ): Promise<PreparedChatRequest> {
    logger.chat.info(
      `[${this.providerId}] Preparing chat request, model: ${modelInfo.id}`,
    );

    const planOverride = await TokenPlan.getInstance().resolvePlanOverride(
      modelInfo.id,
    );

    if (planOverride) {
      logger.chat.info(
        `[${this.providerId}] Using token plan "${planOverride.planId}" for model ${modelInfo.id}`,
      );
    } else {
      const apiKey = await this.modelProvider.getApiKey();
      if (!apiKey) {
        logger.chat.error(`[${this.providerId}] API key not configured`);
        throw new Error("API key not configured");
      }
    }

    const modelDefinition = this.findModelDefinition(modelInfo.id);
    const isThinkingModel = modelDefinition?.capabilities.thinking ?? false;
    const thinkingEffort = this.getConfiguredThinkingEffort(options);

    logger.chat.debug(
      `[${this.providerId}] Model: ${modelInfo.id}, isThinkingModel: ${isThinkingModel}, thinkingEffort: ${thinkingEffort}`,
    );

    const apiMessages = this.convertMessages(messages);
    const tools = modelDefinition?.capabilities.toolCalling
      ? this.convertTools(options.tools)
      : undefined;

    logger.chat.debug(
      `[${this.providerId}] Original messages count: ${messages.length}`,
    );

    const toolChoice =
      tools && tools.length > 0
        ? options.toolMode === vscode.LanguageModelChatToolMode.Required
          ? "required"
          : "auto"
        : undefined;

    const request: ApiRequest = {
      model: this.getApiModelId(modelInfo.id),
      messages: apiMessages,
      stream: true,
      ...(tools ? { tools } : {}),
      ...(toolChoice ? { tool_choice: toolChoice } : {}),
    };

    if (modelDefinition && modelDefinition.maxOutputTokens > 0) {
      request.max_tokens = modelDefinition.maxOutputTokens;
    }

    // If thinking model, add thinking-related parameters
    if (isThinkingModel) {
      this.convertThinkingParams(request, thinkingEffort);
    }

    logger.chat.debug(
      `[${this.providerId}] Prepared request with ${apiMessages.length} messages, tools: ${tools?.length ?? 0}`,
    );

    return {
      request,
      modelDefinition,
      apiMessages,
      ...(tools ? { tools } : {}),
      isThinkingModel,
      thinkingEffort,
      planOverride,
    };
  }

  /**
   * Get configured thinking effort
   */
  protected getConfiguredThinkingEffort(
    options: ModelConfigurationOptions,
  ): ThinkingEffort {
    const configuredEffort =
      options.modelConfiguration?.reasoningEffort ??
      options.modelOptions?.reasoningEffort ??
      options.configuration?.reasoningEffort;

    if (configuredEffort === "none") {
      return "none";
    }
    if (configuredEffort === "high") {
      return "high";
    }
    if (configuredEffort === "max") {
      return "max";
    }
    if (configuredEffort === "low") {
      return "low";
    }
    return "high"; // default value
  }

  /**
   * Get API model ID
   */
  protected getApiModelId(vscodeModelId: string): string {
    if (
      "getApiModelId" in this.modelProvider &&
      typeof this.modelProvider.getApiModelId === "function"
    ) {
      return this.modelProvider.getApiModelId(vscodeModelId);
    }
    return vscodeModelId;
  }

  /**
   * Convert thinking params to API-specific format (subclass can override)
   */
  protected convertThinkingParams(
    request: ApiRequest,
    effort: ThinkingEffort,
  ): void {
    // Default implementation: use reasoning_effort parameter
    if (effort !== "none") {
      request.reasoning_effort = effort;
    }
  }

  private logMessageDetails(
    messages: readonly vscode.LanguageModelChatRequestMessage[],
  ): void {
    if (!logger.shouldLog("debug")) {
      return;
    }
    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i];
      const partsInfo = msg.content.map((p) => {
        if (p instanceof vscode.LanguageModelTextPart) {
          return `TextPart(${p.value.substring(0, 50)}...)`;
        }
        if (p instanceof vscode.LanguageModelToolCallPart) {
          return `ToolCallPart(${p.name})`;
        }
        if (p instanceof vscode.LanguageModelToolResultPart) {
          return `ToolResultPart(${p.callId})`;
        }
        if (p instanceof vscode.LanguageModelDataPart) {
          return `DataPart(${p.mimeType}, ${p.data.length} bytes)`;
        }
        if (p instanceof vscode.LanguageModelThinkingPart) {
          return `ThinkingPart(${p.value.substring(0, 50)}...)`;
        }
        if (p instanceof vscode.LanguageModelPromptTsxPart) {
          return `PromptTsxPart(...)`;
        }
        return `UnknownPart`;
      });
      logger.chat.debug(
        `  Message ${i}: role=${msg.role}, parts=[${partsInfo.join(", ")}]`,
      );
    }
  }

  /**
   * Convert message format (subclass can override)
   */
  protected convertMessages(
    messages: readonly vscode.LanguageModelChatRequestMessage[],
  ): ApiMessage[] {
    logger.chat.debug(
      `[${this.providerId}] Converting ${messages.length} messages`,
    );
    this.logMessageDetails(messages);

    const maxImageSize = getMaxImageSize();
    const result: ApiMessage[] = [];

    for (const message of messages) {
      const role = this.mapRole(message.role);
      const contentParts: ContentPart[] = [];
      let hasImages = false;
      let textBuffer = "";
      let thinkingText = "";
      const toolCalls: ApiToolCall[] = [];
      const toolResults: Array<{ callId: string; content: string }> = [];

      for (const part of message.content) {
        if (part instanceof vscode.LanguageModelTextPart) {
          if (hasImages) {
            contentParts.push({ type: "text", text: part.value });
          } else {
            textBuffer += part.value;
          }
        } else if (part instanceof vscode.LanguageModelThinkingPart) {
          thinkingText += part.value;
        } else if (part instanceof vscode.LanguageModelDataPart) {
          if (!isImageMime(part.mimeType)) {
            continue;
          }

          if (part.data.length > maxImageSize) {
            logger.chat.warn(
              `[${this.providerId}] Image too large (${part.data.length} bytes > ${maxImageSize} max), skipping`,
            );
            continue;
          }

          if (!hasImages) {
            hasImages = true;
            if (textBuffer) {
              contentParts.push({ type: "text", text: textBuffer });
              textBuffer = "";
            }
          }

          contentParts.push({
            type: "image_url",
            image_url: { url: toDataUrl(part.data, part.mimeType) },
          });
        } else if (part instanceof vscode.LanguageModelToolCallPart) {
          toolCalls.push({
            id: part.callId,
            type: "function",
            function: {
              name: part.name,
              arguments: JSON.stringify(part.input),
            },
          });
        } else if (part instanceof vscode.LanguageModelPromptTsxPart) {
          const val =
            typeof part.value === "string"
              ? part.value
              : JSON.stringify(part.value);
          if (hasImages) {
            contentParts.push({ type: "text", text: val });
          } else {
            textBuffer += val;
          }
        } else if (part instanceof vscode.LanguageModelToolResultPart) {
          toolResults.push({
            callId: part.callId,
            content: toolResultContentString(part),
          });
        }
      }

      const finalContent: string | ContentPart[] = hasImages
        ? contentParts
        : textBuffer;

      if (role === "assistant") {
        if (finalContent || toolCalls.length > 0) {
          const msg: ApiMessage = {
            role: "assistant",
            content: finalContent || "",
          };

          if (thinkingText) {
            msg.reasoning_content = thinkingText;
          }

          if (toolCalls.length > 0) {
            msg.tool_calls = toolCalls;
          }

          result.push(msg);
        }
      } else {
        if (
          typeof finalContent === "string"
            ? finalContent
            : finalContent.length > 0
        ) {
          result.push({
            role,
            content: finalContent,
          });
        }
      }

      for (const tr of toolResults) {
        result.push({
          role: "tool",
          content: tr.content,
          tool_call_id: tr.callId,
        });
      }
    }

    logger.chat.debug(
      `[${this.providerId}] Converted to ${result.length} API messages`,
    );
    return result;
  }

  /**
   * Map VS Code message role to API role
   */
  protected mapRole(
    role: vscode.LanguageModelChatMessageRole,
  ): "user" | "assistant" {
    switch (role) {
      case vscode.LanguageModelChatMessageRole.User:
        return "user";
      case vscode.LanguageModelChatMessageRole.Assistant:
        return "assistant";
      default:
        return "user";
    }
  }

  /**
   * Convert tool definitions
   */
  protected convertTools(
    tools: readonly vscode.LanguageModelChatTool[] | undefined,
  ): ApiTool[] | undefined {
    if (!tools || tools.length === 0) {
      return undefined;
    }

    return tools.map((tool) => ({
      type: "function",
      function: {
        name: tool.name,
        ...(tool.description ? { description: tool.description } : {}),
        ...(BaseChatProvider.isRecord(tool.inputSchema)
          ? { parameters: tool.inputSchema }
          : {}),
      },
    }));
  }

  /**
   * Send streaming chat completion request (subclass can override)
   */
  protected async sendStreamRequest(
    request: ApiRequest,
    progress: vscode.Progress<vscode.LanguageModelResponsePart>,
    token: vscode.CancellationToken,
    planOverride?: PlanOverride,
    usageCallback?: (usage: {
      prompt_tokens: number;
      completion_tokens: number;
      total_tokens: number;
    }) => void,
  ): Promise<void> {
    const planBaseUrl = planOverride?.baseUrl;
    logger.chat.info(
      `[${this.providerId}] Sending stream request, model: ${request.model}${planOverride ? ` (via token plan, baseUrl=${sanitizeUrl(planBaseUrl ?? "")})` : ""}`,
    );

    const apiKey =
      planOverride?.apiKey ?? (await this.modelProvider.getApiKey());
    if (!apiKey) {
      throw new Error(`${this.providerName} API key not configured`);
    }

    try {
      const baseUrl = planOverride?.baseUrl;
      const cacheKey = `${baseUrl ?? "__default__"}::${apiKey}`;
      let client = this.clientCache.get(cacheKey);
      if (!client) {
        client = this.modelProvider.createClient(apiKey, { baseUrl });
        this.clientCache.set(cacheKey, client);
      }
      if (planOverride) {
        request.stream = planOverride.stream;
      }
      const callbacks = this.createStreamCallbacks(progress, usageCallback);
      await client.streamChatCompletion(request, callbacks, token);
    } catch (error) {
      if (error instanceof CancelledError) {
        logger.chat.debug(`[${this.providerId}] Request cancelled`);
        throw error;
      }

      if (error instanceof TimeoutError) {
        logger.chat.error(`[${this.providerId}] Request timeout`);
        throw error;
      }

      if (error instanceof ApiError) {
        logger.chat.error(`[${this.providerId}] API error: ${error.message}`);
        throw error;
      }

      if (error instanceof Error && error.message.includes("timeout")) {
        throw new TimeoutError(this.providerName, 0);
      }

      throw error;
    }
  }

  /**
   * Create stream callbacks
   */
  protected createStreamCallbacks(
    progress: vscode.Progress<vscode.LanguageModelResponsePart>,
    usageCallback?: (usage: {
      prompt_tokens: number;
      completion_tokens: number;
      total_tokens: number;
    }) => void,
  ): StreamCallbacks {
    // Only accumulate full content for debug logging; skip in production to save memory
    const shouldLogDebug = logger.shouldLog("debug");
    let content = shouldLogDebug ? "" : undefined;
    let thinking = shouldLogDebug ? "" : undefined;
    let toolCalls = shouldLogDebug
      ? ([] as { name: string; args: string }[])
      : undefined;
    let finalUsage: {
      prompt_tokens: number;
      completion_tokens: number;
      total_tokens: number;
    } | null = null;

    return {
      onContent: (text: string) => {
        if (content !== undefined) {
          content += text;
        }
        progress.report(new vscode.LanguageModelTextPart(text));
      },
      onThinking: (text: string) => {
        if (thinking !== undefined) {
          thinking += text;
        }
        BaseChatProvider.reportThinkingPart(progress, text);
      },
      onToolCall: (toolCall) => {
        try {
          const args = JSON.parse(toolCall.function.arguments);
          if (toolCalls) {
            toolCalls.push({
              name: toolCall.function.name,
              args: JSON.stringify(args),
            });
          }
          progress.report(
            new vscode.LanguageModelToolCallPart(
              toolCall.id,
              toolCall.function.name,
              args,
            ),
          );
        } catch {
          if (toolCalls) {
            toolCalls.push({
              name: toolCall.function.name,
              args: toolCall.function.arguments,
            });
          }
          progress.report(
            new vscode.LanguageModelToolCallPart(
              toolCall.id,
              toolCall.function.name,
              {},
            ),
          );
        }
      },
      onUsage: (usage) => {
        finalUsage = {
          prompt_tokens: usage.prompt_tokens,
          completion_tokens: usage.completion_tokens,
          total_tokens: usage.total_tokens,
        };
      },
      onError: (error: Error) => {
        logger.stream.error(
          `[${this.providerId}] Stream error: ${error.message}`,
        );
        throw error;
      },
      onDone: () => {
        // Log full response content (debug only)
        if (content) {
          logger.stream.debug(
            `[${this.providerId}] === Response Content ===\n${content}`,
          );
        }

        // Log thinking content (debug only)
        if (thinking) {
          logger.stream.debug(
            `[${this.providerId}] === Thinking Content ===\n${thinking}`,
          );
        }

        // Log tool calls (debug only)
        if (toolCalls && toolCalls.length > 0) {
          logger.stream.debug(
            `[${this.providerId}] === Tool Calls (${toolCalls.length}) ===`,
          );
          for (const tc of toolCalls) {
            logger.stream.debug(`  - ${tc.name}: ${tc.args}`);
          }
        }

        // Log token usage statistics and invoke usage callback
        if (finalUsage) {
          logger.stream.debug(
            `[${this.providerId}] === Token Usage ===\n` +
              `  prompt_tokens: ${finalUsage.prompt_tokens}\n` +
              `  completion_tokens: ${finalUsage.completion_tokens}\n` +
              `  total_tokens: ${finalUsage.total_tokens}`,
          );
          usageCallback?.(finalUsage);
        }
      },
    };
  }

  /**
   * Provide chat response
   */
  async provideLanguageModelChatResponse(
    modelInfo: vscode.LanguageModelChatInformation,
    messages: readonly vscode.LanguageModelChatRequestMessage[],
    options: vscode.ProvideLanguageModelChatResponseOptions,
    progress: vscode.Progress<vscode.LanguageModelResponsePart>,
    token: vscode.CancellationToken,
  ): Promise<void> {
    // Inherit the requestId set by the router (or generate one) so all logs
    // for this request — routing, provider, client, stream — share a single
    // req=<id> tag for fast troubleshooting.
    const existing = getLogContext();
    const ctx: LogContext = {
      requestId: existing?.requestId ?? generateRequestId(),
      providerId: this.providerId,
      modelId: modelInfo.id,
    };
    return withLogContext(ctx, () =>
      this.doProvideLanguageModelChatResponse(
        modelInfo,
        messages,
        options,
        progress,
        token,
      ),
    );
  }

  private async doProvideLanguageModelChatResponse(
    modelInfo: vscode.LanguageModelChatInformation,
    messages: readonly vscode.LanguageModelChatRequestMessage[],
    options: vscode.ProvideLanguageModelChatResponseOptions,
    progress: vscode.Progress<vscode.LanguageModelResponsePart>,
    token: vscode.CancellationToken,
  ): Promise<void> {
    const startTime = Date.now();
    logger.chat.info(
      `[${this.providerId}] provideLanguageModelChatResponse called, model: ${modelInfo.id}`,
    );
    try {
      // Models with native image input must see the real images — routing
      // them through the vision proxy would downgrade them to a lossy text
      // description.
      const modelDefinition = this.findModelDefinition(modelInfo.id);
      const visionResolution = await resolveImageMessages(
        messages,
        token,
        this.visionService,
        { skipVisionProxy: modelDefinition?.capabilities.imageInput === true },
      );

      // Report vision proxy notice if available
      if (visionResolution.initialResponseNotice) {
        progress.report(
          new vscode.LanguageModelTextPart(
            visionResolution.initialResponseNotice,
          ),
        );
      }

      const prepared = await this.prepareChatRequest(
        modelInfo,
        visionResolution.messages,
        options,
      );
      // Usage is recorded for every request, not only token plan ones, so the
      // status bar and the usage report cover direct API-key traffic too.
      const usageCallback = (usage: {
        prompt_tokens: number;
        completion_tokens: number;
        total_tokens: number;
      }) => {
        const plan = prepared.planOverride;
        const rate = plan?.consumptionRate ?? 1;
        // `recordConsumption` writes to globalState asynchronously. Not
        // awaiting it is intentional (it must not block or fail the chat
        // response), but the rejection still needs a handler.
        TokenPlan.getInstance()
          .recordConsumption({
            ...(plan ? { planId: plan.planId } : {}),
            providerId: this.providerId,
            modelId: modelInfo.id,
            promptTokens: Math.round(usage.prompt_tokens * rate),
            completionTokens: Math.round(usage.completion_tokens * rate),
            totalTokens: Math.round(usage.total_tokens * rate),
            timestamp: Date.now(),
          })
          .catch((error: unknown) => {
            logger.plan.error(
              `Failed to record usage for model "${modelInfo.id}":`,
              error,
            );
          });
      };
      await this.sendStreamRequest(
        prepared.request,
        progress,
        token,
        prepared.planOverride,
        usageCallback,
      );
      const duration = Date.now() - startTime;
      logger.chat.info(
        `[${this.providerId}] Chat response completed successfully, duration: ${duration}ms`,
      );
    } catch (error) {
      logger.chat.error(`[${this.providerId}] Chat response failed:`, error);
      throw error;
    }
  }

  /**
   * Provide token count estimation
   */
  async provideTokenCount(
    _modelInfo: vscode.LanguageModelChatInformation,
    text: string | vscode.LanguageModelChatRequestMessage,
    _token: vscode.CancellationToken,
  ): Promise<number> {
    const content =
      typeof text === "string" ? text : this.extractTextFromMessage(text);
    return this.estimateTokenCount(content);
  }

  /**
   * Calculate token count accurately
   * Uses o200k_base encoding (via @dqbd/tiktoken WASM)
   * Falls back to heuristic estimation when WASM fails to load
   */
  private estimateTokenCount(text: string): number {
    return Tokenizer.getInstance().countTokens(text);
  }

  /**
   * The text a message contributes to the request, for token estimation.
   *
   * Must cover the same parts `convertMessages` sends, or the reported count
   * drifts below what the provider actually receives — and this number is what
   * VS Code uses to decide whether the context still fits. Counting only text
   * parts made a tool-heavy conversation look far smaller than its request.
   * Images are deliberately excluded: they are sent as data URLs, whose length
   * is dominated by base64 rather than by anything a token estimate can model.
   */
  private extractTextFromMessage(
    message: vscode.LanguageModelChatRequestMessage,
  ): string {
    const chunks: string[] = [];

    for (const part of message.content) {
      if (part instanceof vscode.LanguageModelTextPart) {
        chunks.push(part.value);
      } else if (part instanceof vscode.LanguageModelToolCallPart) {
        chunks.push(part.name, JSON.stringify(part.input));
      } else if (part instanceof vscode.LanguageModelToolResultPart) {
        chunks.push(toolResultContentString(part));
      } else if (part instanceof vscode.LanguageModelPromptTsxPart) {
        chunks.push(
          typeof part.value === "string"
            ? part.value
            : JSON.stringify(part.value),
        );
      }
    }

    return chunks.join("\n");
  }

  /**
   * Refresh model picker
   */
  refreshModelPicker(): void {
    logger.provider.debug(`[${this.providerId}] Refreshing model picker`);
    this.onDidChangeLanguageModelChatInformationEmitter.fire();
  }

  /**
   * Prepare for deactivation
   */
  async prepareForDeactivate(): Promise<void> {
    logger.provider.debug(`[${this.providerId}] Preparing for deactivation`);
    this.isActive = false;
    this.onDidChangeLanguageModelChatInformationEmitter.fire();
  }
}
