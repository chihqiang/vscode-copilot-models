/**
 * Logger — OOP singleton logger
 *
 * Provides categorized log output to VS Code OutputChannel with support for:
 * - 4 log levels: debug / info / warn / error
 * - 10 categories: core / registry / provider / auth / api / chat / stream / config / router / plan
 * - Hot-reload: follows copilot-models.debugMode config changes
 * - In development mode, debug level also outputs to console.log
 *
 * Usage:
 *   import { logger } from "./core/logger";   // backward-compatible proxy
 *   logger.core.info("message");
 *   logger.api.debug("debug info");
 */

import vscode from "vscode";
import { isDevelopmentEnvironment } from "./runtime";
import { CONFIG_SECTION } from "./models";

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
  | "plan";

export interface CategoryLogger {
  info: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
  debug: (...args: unknown[]) => void;
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
};

const ALL_CATEGORIES: LogCategory[] = [
  "core", "registry", "provider", "auth", "api",
  "chat", "stream", "config", "router", "plan",
];

// ── Logger Class ───────────────────────────────

export class Logger implements vscode.Disposable {
  private static instance: Logger | undefined;

  private channel: vscode.OutputChannel | undefined;
  private showCategory = true;
  private currentLogLevel: LogLevel = "info";
  private developmentMode = false;
  private readonly categoryLoggers = new Map<string, CategoryLogger>();

  private constructor() {
    for (const cat of ALL_CATEGORIES) {
      this.categoryLoggers.set(cat, this.createCategoryLogger(cat));
    }
  }

  static init(context: vscode.ExtensionContext): Logger {
    if (!Logger.instance) {
      Logger.instance = new Logger();
    }
    const sys = Logger.instance;
    sys.developmentMode =
      context.extensionMode === vscode.ExtensionMode.Development ||
      isDevelopmentEnvironment() ||
      context.extensionMode === vscode.ExtensionMode.Test;
    sys.currentLogLevel = sys.developmentMode ? "debug" : "info";
    sys.applyLogLevelFromConfig();
    return sys;
  }

  static getInstance(): Logger {
    if (!Logger.instance) {
      Logger.instance = new Logger();
    }
    return Logger.instance;
  }

  static resetInstance(): void {
    Logger.instance?.dispose();
    Logger.instance = undefined;
  }

  // ── Category accessors ───────────────────────────

  get core(): CategoryLogger { return this.getCategory("core"); }
  get registry(): CategoryLogger { return this.getCategory("registry"); }
  get provider(): CategoryLogger { return this.getCategory("provider"); }
  get auth(): CategoryLogger { return this.getCategory("auth"); }
  get api(): CategoryLogger { return this.getCategory("api"); }
  get chat(): CategoryLogger { return this.getCategory("chat"); }
  get stream(): CategoryLogger { return this.getCategory("stream"); }
  get config(): CategoryLogger { return this.getCategory("config"); }
  get router(): CategoryLogger { return this.getCategory("router"); }
  get plan(): CategoryLogger { return this.getCategory("plan"); }

  // ── Top-level log methods (default to "core") ────

  info(...args: unknown[]): void { this.write("info", "core", args); }
  warn(...args: unknown[]): void { this.write("warn", "core", args); }
  error(...args: unknown[]): void { this.write("error", "core", args); }
  debug(...args: unknown[]): void { this.write("debug", "core", args); }

  // ── Public API ───────────────────────────────────

  get level(): LogLevel { return this.currentLogLevel; }
  set level(level: LogLevel) { this.currentLogLevel = level; }

  shouldLog(level: LogLevel): boolean {
    return LOG_LEVEL_PRIORITY[level] >= LOG_LEVEL_PRIORITY[this.currentLogLevel];
  }

  applyLogLevelFromConfig(): void {
    if (this.developmentMode) {
      return;
    }
    try {
      const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
      const debugMode = config.get<string>("debugMode");
      if (debugMode && DEBUG_MODE_MAP[debugMode]) {
        this.currentLogLevel = DEBUG_MODE_MAP[debugMode];
      }
    } catch {
      // VS Code API may not be available during early init
    }
  }

  createProviderLogger(providerId: string): CategoryLogger {
    return this.createCategoryLogger(providerId as LogCategory);
  }

  show(): void { this.getChannel().show(); }
  hide(): void { this.getChannel().hide(); }
  clear(): void { this.getChannel().clear(); }

  dispose(): void {
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

  private getChannel(): vscode.OutputChannel {
    if (!this.channel) {
      this.channel = vscode.window.createOutputChannel("Copilot Models");
    }
    return this.channel;
  }

  private write(level: LogLevel, category: string, args: unknown[]): void {
    if (!this.shouldLog(level)) {
      return;
    }

    const text = this.formatMessage(level, category, args);
    this.getChannel().appendLine(text);

    if (this.developmentMode && level === "debug") {
      console.log(text);
    }
  }

  private formatMessage(level: LogLevel, category: string, args: unknown[]): string {
    const ts = new Date().toISOString().slice(11, 23);
    const levelStr = level.toUpperCase().padEnd(5);
    const categoryText = this.showCategory
      ? `[${CATEGORY_NAMES[category as LogCategory] ?? category}] `
      : "";
    const prefix = `[${ts}] [${levelStr}] ${categoryText}`;

    const text = args
      .map((a) => {
        if (typeof a === "string") {
          return a;
        }
        if (a instanceof Error) {
          return a.stack ?? a.message;
        }
        try {
          return JSON.stringify(a, null, 2);
        } catch {
          return String(a);
        }
      })
      .join(" ");

    return `${prefix}${text}`;
  }
}

// ── Singleton export ─────────────────────────────│

const _instance = Logger.getInstance();
export const logger: Logger = _instance;

