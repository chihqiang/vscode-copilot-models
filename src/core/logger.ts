/**
 * Logger — OOP singleton logger
 *
 * Provides categorized log output to VS Code OutputChannel with support for:
 * - 4 log levels: debug / info / warn / error
 * - 10 categories: core / registry / provider / auth / api / chat / stream / config / router / plan
 * - Hot-reload: follows copilot-models.debugMode config changes
 * - In development mode, debug level also outputs to console.log
 * - Per-request context (requestId / providerId / modelId) propagated via
 *   AsyncLocalStorage, so every log line of one request carries a common
 *   `req=<id>` tag for fast cross-module traceability.
 *
 * Usage:
 *   import { logger, withLogContext, generateRequestId } from "./core/logger";
 *   logger.core.info("message");
 *   logger.api.debug("debug info");
 */

import { AsyncLocalStorage } from "node:async_hooks";
import vscode from "vscode";
import { isDevelopmentEnvironment, isTestEnvironment } from "./runtime";
import { getDebugMode } from "./settings";
import { redactSensitiveValues } from "./sanitize";
import { createSingletonStore } from "./singleton";

// ── Types ────────────────────────────────────────────

export type LogLevel = "debug" | "info" | "warn" | "error";

export type LogCategory =
  | "core"
  | "registry"
  | "provider"
  | "auth"
  | "api"
  | "chat"
  | "stream"
  | "config"
  | "router"
  | "plan"
  | "vision";

export interface CategoryLogger {
  info: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
  debug: (...args: unknown[]) => void;
}

/**
 * Structured context attached to a single request, propagated through async
 * call chains so every log line of one request shares the same tags.
 */
export interface LogContext {
  /** Request correlation ID (stable across router/provider/client logs) */
  requestId?: string;
  /** Provider handling the request */
  providerId?: string;
  /** Model being invoked */
  modelId?: string;
}

// ── Request context (AsyncLocalStorage) ───────────────

const asyncLocalStorage = new AsyncLocalStorage<LogContext>();

/**
 * Run a block with request context attached. Every log emitted inside `fn`
 * (including async descendants) will carry the context tags.
 */
export function withLogContext<T>(ctx: LogContext, fn: () => T): T {
  return asyncLocalStorage.run(ctx, fn);
}

/** Read the current request context (undefined outside a request) */
export function getLogContext(): LogContext | undefined {
  return asyncLocalStorage.getStore();
}

/** Generate a short request correlation ID (6 hex chars) */
export function generateRequestId(): string {
  return Math.random().toString(16).slice(2, 8);
}

// ── Constants ────────────────────────────────────────

const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const DEBUG_MODE_MAP: Record<string, LogLevel> = {
  minimal: "warn",
  metadata: "info",
  verbose: "debug",
};

const CATEGORY_NAMES: Record<LogCategory, string> = {
  core: "Core",
  registry: "Registry",
  provider: "Provider",
  auth: "Auth",
  api: "API",
  chat: "Chat",
  stream: "Stream",
  config: "Config",
  router: "Router",
  plan: "Plan",
  vision: "Vision",
};

const ALL_CATEGORIES: LogCategory[] = [
  "core",
  "registry",
  "provider",
  "auth",
  "api",
  "chat",
  "stream",
  "config",
  "router",
  "plan",
  "vision",
];

// ── Logger Class ───────────────────────────────

export class Logger implements vscode.Disposable {
  private static store = createSingletonStore<Logger>({
    lazyCreate: () => new Logger(),
  });

  private channel: vscode.OutputChannel | undefined;
  private showCategory = true;
  private currentLogLevel: LogLevel = "info";
  private developmentMode = false;
  private testMode = false;
  private disposed = false;
  private readonly categoryLoggers = new Map<string, CategoryLogger>();

  private constructor() {
    for (const cat of ALL_CATEGORIES) {
      this.categoryLoggers.set(cat, this.createCategoryLogger(cat));
    }
  }

  static init(context: vscode.ExtensionContext): Logger {
    const sys = Logger.getInstance();
    sys.developmentMode =
      context.extensionMode === vscode.ExtensionMode.Development ||
      isDevelopmentEnvironment() ||
      context.extensionMode === vscode.ExtensionMode.Test;
    sys.testMode =
      context.extensionMode === vscode.ExtensionMode.Test ||
      isTestEnvironment();
    sys.currentLogLevel = sys.developmentMode ? "debug" : "info";
    sys.applyLogLevelFromConfig();
    return sys;
  }

  static getInstance(): Logger {
    return Logger.store.get();
  }

  static resetInstance(): void {
    const inst = Logger.store.getOptional();
    inst?.dispose();
    Logger.store.reset();
  }

  // ── Category accessors ───────────────────────────

  get core(): CategoryLogger {
    return this.getCategory("core");
  }
  get registry(): CategoryLogger {
    return this.getCategory("registry");
  }
  get provider(): CategoryLogger {
    return this.getCategory("provider");
  }
  get auth(): CategoryLogger {
    return this.getCategory("auth");
  }
  get api(): CategoryLogger {
    return this.getCategory("api");
  }
  get chat(): CategoryLogger {
    return this.getCategory("chat");
  }
  get stream(): CategoryLogger {
    return this.getCategory("stream");
  }
  get config(): CategoryLogger {
    return this.getCategory("config");
  }
  get router(): CategoryLogger {
    return this.getCategory("router");
  }
  get plan(): CategoryLogger {
    return this.getCategory("plan");
  }
  get vision(): CategoryLogger {
    return this.getCategory("vision");
  }

  // ── Top-level log methods (default to "core") ────

  info(...args: unknown[]): void {
    this.write("info", "core", args);
  }
  warn(...args: unknown[]): void {
    this.write("warn", "core", args);
  }
  error(...args: unknown[]): void {
    this.write("error", "core", args);
  }
  debug(...args: unknown[]): void {
    this.write("debug", "core", args);
  }

  // ── Public API ───────────────────────────────────

  get level(): LogLevel {
    return this.currentLogLevel;
  }
  set level(level: LogLevel) {
    this.currentLogLevel = level;
  }

  shouldLog(level: LogLevel): boolean {
    return (
      LOG_LEVEL_PRIORITY[level] >= LOG_LEVEL_PRIORITY[this.currentLogLevel]
    );
  }

  applyLogLevelFromConfig(): void {
    if (this.developmentMode) {
      return;
    }
    try {
      const debugMode = getDebugMode();
      if (debugMode && DEBUG_MODE_MAP[debugMode]) {
        this.currentLogLevel = DEBUG_MODE_MAP[debugMode];
      }
    } catch {
      // VS Code API may not be available during early init
    }
  }

  show(): void {
    this.getChannel()?.show();
  }
  hide(): void {
    this.getChannel()?.hide();
  }
  clear(): void {
    this.getChannel()?.clear();
  }

  dispose(): void {
    this.disposed = true;
    this.channel?.dispose();
    this.channel = undefined;
  }

  // ── Private ──────────────────────────────────────

  private getCategory(name: string): CategoryLogger {
    const existing = this.categoryLoggers.get(name);
    if (existing) {
      return existing;
    }
    const created = this.createCategoryLogger(name as LogCategory);
    this.categoryLoggers.set(name, created);
    return created;
  }

  private createCategoryLogger(category: LogCategory): CategoryLogger {
    return {
      info: (...args: unknown[]) => this.write("info", category, args),
      warn: (...args: unknown[]) => this.write("warn", category, args),
      error: (...args: unknown[]) => this.write("error", category, args),
      debug: (...args: unknown[]) => this.write("debug", category, args),
    };
  }

  private getChannel(): vscode.OutputChannel | undefined {
    if (this.disposed || this.testMode) {
      return undefined;
    }
    if (!this.channel) {
      this.channel = vscode.window.createOutputChannel("Copilot Models");
    }
    return this.channel;
  }

  private write(level: LogLevel, category: string, args: unknown[]): void {
    if (this.disposed || !this.shouldLog(level)) {
      return;
    }

    const text = this.formatMessage(level, category, args);

    // In test mode, avoid creating an OutputChannel: its async init can
    // complete after the extension host's DisposableStore is disposed,
    // producing "Trying to add a disposable..." warnings. Log to console.
    if (this.testMode) {
      if (level === "error") {
        console.error(text);
      } else if (level === "warn") {
        console.warn(text);
      } else {
        console.log(text);
      }
      return;
    }

    this.getChannel()?.appendLine(text);

    if (this.developmentMode && level === "debug") {
      console.log(text);
    }
  }

  private formatMessage(
    level: LogLevel,
    category: string,
    args: unknown[],
  ): string {
    const ts = new Date().toISOString().slice(11, 23);
    const levelStr = level.toUpperCase().padEnd(5);
    const categoryText = this.showCategory
      ? `[${CATEGORY_NAMES[category as LogCategory] ?? category}] `
      : "";

    // Structured per-request context, e.g.
    //   req=a1b2c3 provider=deepseek model=deepseek-v4-flash
    const ctx = getLogContext();
    const ctxText = ctx
      ? `req=${ctx.requestId ?? "-"} provider=${ctx.providerId ?? "-"} model=${ctx.modelId ?? "-"} `
      : "";
    const prefix = `[${ts}] [${levelStr}] ${categoryText}${ctxText}`;

    const text = args
      .map((a) => {
        if (typeof a === "string") {
          return a;
        }
        if (a instanceof Error) {
          return a.stack ?? a.message;
        }
        try {
          // Single-line compact JSON keeps one log entry per line for easy
          // grepping.
          return JSON.stringify(a);
        } catch {
          return String(a);
        }
      })
      .join(" ");

    // Final safety net: redact any sensitive values (API keys, tokens,
    // Bearer headers, key=value pairs) that slipped into the message.
    return `${prefix}${redactSensitiveValues(text)}`;
  }
}

// ── Singleton export ─────────────────────────────│

const _instance = Logger.getInstance();
export const logger: Logger = _instance;
