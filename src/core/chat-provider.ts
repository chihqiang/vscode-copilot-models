/**
 * Base Chat Provider - Common logic for vscode.LanguageModelChatProvider
 */

import vscode from "vscode";
import { logger } from "./logger";
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
import { IModelProvider } from "./model-provider";
import { Tokenizer } from "./tokenizer";
import { TokenPlan, type PlanOverride } from "./token-plan";

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

/**
 * Conversation segment info
 */
export interface ConversationSegment {
  index: number;
  id: string;
  timestamp: number;
}

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
  protected isActive = true;
  private disposables: vscode.Disposable[] = [];
  private clientCache = new Map<string, IApiClient>();

  readonly onDidChangeLanguageModelChatInformation =
    this.onDidChangeLanguageModelChatInformationEmitter.event;

  // ── Static helpers ───────────────────────────────

  private static hasTimestamp(msg: unknown): msg is { timestamp: number } {
    if (typeof msg !== "object" || msg === null) {
      return false;
    }
    const timestamp = Reflect.get(msg, "timestamp");
    return typeof timestamp === "number";
  }

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

    logger.provider.debug(`[${this.providerId}] ChatProvider initialized`);

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
    return (
      e.affectsConfiguration(
        `${this.configSection}.${this.providerId}.baseUrl`,
      ) || e.affectsConfiguration(`${this.configSection}.modelIdOverrides`)
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
      this.onDidChangeLanguageModelChatInformationEmitter.fire();
    }
    if (this.isActive && e.key.startsWith("copilot-models.tokenPlan.")) {
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

    const hasApiKey = await this.modelProvider.hasApiKey();
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
   * Get conversation segment info
   */
  protected resolveConversationSegment(
    messages: readonly vscode.LanguageModelChatRequestMessage[],
  ): ConversationSegment {
    if (messages.length === 0) {
      logger.chat.debug("No messages, creating new segment");
      return { index: 0, id: `seg-${Date.now()}`, timestamp: Date.now() };
    }

    let latestTimestamp = 0;
    let index = 0;
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];
      if (BaseChatProvider.hasTimestamp(msg)) {
        latestTimestamp = msg.timestamp;
        index = i;
        break;
      }
    }

    const segment = {
      index,
      id: `seg-${latestTimestamp || Date.now()}`,
      timestamp: latestTimestamp || Date.now(),
    };
    logger.chat.debug(
      `Resolved segment: ${segment.id}, index: ${segment.index}`,
    );
    return segment;
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

    const modelDefinition = this.modelProvider
      .getModels()
      .find((m) => m.id === modelInfo.id);
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

    const maxImageSize = this.getMaxImageSize();
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
          if (!this.isImageMime(part.mimeType)) {
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
            image_url: { url: this.imageToDataUrl(part.data, part.mimeType) },
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
          let toolContent = "";
          for (const item of part.content) {
            if (item instanceof vscode.LanguageModelTextPart) {
              toolContent += item.value;
            }
          }
          toolResults.push({
            callId: part.callId,
            content: toolContent || JSON.stringify(part.content),
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
      `[${this.providerId}] Sending stream request, model: ${request.model}${planOverride ? ` (via token plan, baseUrl=${planBaseUrl})` : ""}`,
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
    let content = "";
    let thinking = "";
    let toolCalls: { name: string; args: string }[] = [];
    let finalUsage: {
      prompt_tokens: number;
      completion_tokens: number;
      total_tokens: number;
    } | null = null;

    return {
      onContent: (text: string) => {
        content += text;
        progress.report(new vscode.LanguageModelTextPart(text));
      },
      onThinking: (text: string) => {
        thinking += text;
        BaseChatProvider.reportThinkingPart(progress, text);
      },
      onToolCall: (toolCall) => {
        try {
          const args = JSON.parse(toolCall.function.arguments);
          toolCalls.push({
            name: toolCall.function.name,
            args: JSON.stringify(args),
          });
          progress.report(
            new vscode.LanguageModelToolCallPart(
              toolCall.id,
              toolCall.function.name,
              args,
            ),
          );
        } catch {
          toolCalls.push({
            name: toolCall.function.name,
            args: toolCall.function.arguments,
          });
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
        // Log full response content
        if (content) {
          logger.stream.debug(
            `[${this.providerId}] === Response Content ===\n${content}`,
          );
        }

        // Log thinking content
        if (thinking) {
          logger.stream.debug(
            `[${this.providerId}] === Thinking Content ===\n${thinking}`,
          );
        }

        // Log tool calls
        if (toolCalls.length > 0) {
          logger.stream.debug(
            `[${this.providerId}] === Tool Calls (${toolCalls.length}) ===`,
          );
          for (const tc of toolCalls) {
            logger.stream.debug(`  - ${tc.name}: ${tc.args}`);
          }
        }

        // Log token usage statistics
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
    const startTime = Date.now();
    logger.chat.info(
      `[${this.providerId}] provideLanguageModelChatResponse called, model: ${modelInfo.id}`,
    );
    try {
      const prepared = await this.prepareChatRequest(
        modelInfo,
        messages,
        options,
      );
      const usageCallback = prepared.planOverride
        ? (usage: {
            prompt_tokens: number;
            completion_tokens: number;
            total_tokens: number;
          }) => {
            const rate = prepared.planOverride!.consumptionRate ?? 1;
            TokenPlan.getInstance().recordConsumption({
              planId: prepared.planOverride!.planId,
              modelId: modelInfo.id,
              promptTokens: Math.round(usage.prompt_tokens * rate),
              completionTokens: Math.round(usage.completion_tokens * rate),
              totalTokens: Math.round(usage.total_tokens * rate),
              timestamp: Date.now(),
            });
          }
        : undefined;
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
   * Extract text content from message
   */
  private getMaxImageSize(): number {
    const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
    return config.get<number>("maxImageSize") ?? 20 * 1024 * 1024;
  }

  private isImageMime(mimeType: string): boolean {
    return mimeType.startsWith("image/");
  }

  private imageToDataUrl(data: Uint8Array, mimeType: string): string {
    const base64 = this.uint8ArrayToBase64(data);
    return `data:${mimeType};base64,${base64}`;
  }

  private uint8ArrayToBase64(bytes: Uint8Array): string {
    return Buffer.from(bytes).toString("base64");
  }

  private extractTextFromMessage(
    message: vscode.LanguageModelChatRequestMessage,
  ): string {
    let text = "";
    for (const part of message.content) {
      if (part instanceof vscode.LanguageModelTextPart) {
        text += part.value;
      }
    }
    return text;
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
