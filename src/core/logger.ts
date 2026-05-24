/**
 * Logger system
 *
 * Provides categorized log output to VS Code OutputChannel with support for:
 * - 4 log levels: debug / info / warn / error
 * - 9 categories: core / registry / provider / auth / api / chat / stream / config / router
 * - Auto-clear: exceeds 10000 lines, automatically clears
 * - Hot-reload: follows copilot-models.debugMode config changes
 * - In development mode, debug level also outputs to console.log
 */

import vscode from 'vscode';
import { isDevelopmentEnvironment } from './runtime';

/** Log level */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/** Log level priority (higher number = more important) */
const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

/** Mapping from debugMode config value to log level */
const DEBUG_MODE_MAP: Record<string, LogLevel> = {
  minimal: 'warn',
  metadata: 'info',
  verbose: 'debug',
};

/** Log category */
export type LogCategory =
  | 'core' | 'registry' | 'provider' | 'auth'
  | 'api' | 'chat' | 'stream' | 'config' | 'router';

/** Category display name mapping */
const CATEGORY_NAMES: Record<LogCategory, string> = {
  core: 'Core',
  registry: 'Registry',
  provider: 'Provider',
  auth: 'Auth',
  api: 'API',
  chat: 'Chat',
  stream: 'Stream',
  config: 'Config',
  router: 'Router',
};

/** Auto-clear threshold */
const MAX_LOG_LINES = 10000;

let channel: vscode.OutputChannel | undefined;
let showCategory = true;
let currentLogLevel: LogLevel = 'info';
let isDevelopmentMode = false;
let lineCount = 0;

/** VS Code configuration section */
const CONFIG_SECTION = 'copilot-models';

/** Get default log level (debug for development mode, otherwise info) */
function getDefaultLogLevel(): LogLevel {
  return isDevelopmentMode ? 'debug' : 'info';
}

/** Read debugMode from VS Code config and apply corresponding log level */
export function applyLogLevelFromConfig(): void {
  if (isDevelopmentMode) { return; }
  try {
    const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
    const debugMode = config.get<string>('debugMode');
    if (debugMode && DEBUG_MODE_MAP[debugMode]) {
      setLogLevel(DEBUG_MODE_MAP[debugMode]);
    }
  } catch {
    // VS Code API may not be available during early init
  }
}

/** Initialize logger system, set default level based on extension mode */
export function initLogger(context: vscode.ExtensionContext): void {
  isDevelopmentMode = context.extensionMode === vscode.ExtensionMode.Development
    || isDevelopmentEnvironment()
    || context.extensionMode === vscode.ExtensionMode.Test;
  currentLogLevel = getDefaultLogLevel();
  applyLogLevelFromConfig();
}

/** Get or create OutputChannel */
function getChannel(): vscode.OutputChannel {
  if (!channel) {
    channel = vscode.window.createOutputChannel('Copilot Models');
  }
  return channel;
}

/** Get HH:MM:SS.mmm timestamp */
function ts(): string {
  return new Date().toISOString().slice(11, 23);
}

/** Get category display name */
function getCategoryName(category: string): string {
  return CATEGORY_NAMES[category as LogCategory] ?? category;
}

/** Check if current level should log */
export function shouldLog(level: LogLevel): boolean {
  return LOG_LEVEL_PRIORITY[level] >= LOG_LEVEL_PRIORITY[currentLogLevel];
}

/** Lazily format message (concatenate strings only when outputting to avoid unnecessary overhead) */
function lazyFormatMessage(level: string, category: string, args: unknown[]): () => string {
  return () => {
    const categoryText = showCategory ? `[${getCategoryName(category)}] ` : '';
    const prefix = `[${ts()}] [${level}] ${categoryText}`;

    const text = args.map((a) => {
      if (typeof a === 'string') { return a; }
      if (a instanceof Error) { return a.stack ?? a.message; }
      try { return JSON.stringify(a, null, 2); }
      catch { return String(a); }
    }).join(' ');

    return `${prefix}${text}`;
  };
}

/** Check if line count exceeds limit, clear OutputChannel if so */
function checkAutoClear(): void {
  if (lineCount >= MAX_LOG_LINES) {
    getChannel().clear();
    lineCount = 0;
    const notice = `[${ts()}] [INFO ] [Core] Log truncated: exceeded ${MAX_LOG_LINES} lines`;
    getChannel().appendLine(notice);
    if (isDevelopmentMode) {
      console.log(notice);
    }
  }
}

/** Write log to OutputChannel */
function write(level: LogLevel, category: string, args: unknown[]): void {
  if (!shouldLog(level)) { return; }

  checkAutoClear();

  const levelStr = level.toUpperCase().padEnd(5);
  const formatFn = lazyFormatMessage(levelStr, category, args);
  const text = formatFn();
  getChannel().appendLine(text);
  lineCount++;

  if (isDevelopmentMode && level === 'debug') {
    console.log(text);
  }
}

export function setShowCategory(show: boolean): void { showCategory = show; }
export function setLogLevel(level: LogLevel): void { currentLogLevel = level; }
export function getLogLevel(): LogLevel { return currentLogLevel; }
export function isDevMode(): boolean { return isDevelopmentMode; }

/** Logger interface (4 level methods) */
export interface Logger {
  info: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
  debug: (...args: unknown[]) => void;
}

/** Create category logger */
function createCategoryLogger(category: LogCategory): Logger {
  return {
    info: (...args: unknown[]) => write('info', category, args),
    warn: (...args: unknown[]) => write('warn', category, args),
    error: (...args: unknown[]) => write('error', category, args),
    debug: (...args: unknown[]) => write('debug', category, args),
  };
}

/** Create category logger for a specific provider */
export function createProviderLogger(providerId: string, _providerName: string): Logger {
  return createCategoryLogger(providerId as LogCategory);
}

export const logger = {
  core: createCategoryLogger('core'),
  registry: createCategoryLogger('registry'),
  provider: createCategoryLogger('provider'),
  auth: createCategoryLogger('auth'),
  api: createCategoryLogger('api'),
  chat: createCategoryLogger('chat'),
  stream: createCategoryLogger('stream'),
  config: createCategoryLogger('config'),
  router: createCategoryLogger('router'),

  info: (...args: unknown[]) => write('info', 'core', args),
  warn: (...args: unknown[]) => write('warn', 'core', args),
  error: (...args: unknown[]) => write('error', 'core', args),
  debug: (...args: unknown[]) => write('debug', 'core', args),

  show: () => getChannel().show(),
  hide: () => getChannel().hide(),
  clear: () => { getChannel().clear(); lineCount = 0; },

  get level(): LogLevel { return currentLogLevel; },
  set level(level: LogLevel) { currentLogLevel = level; },

  dispose: () => {
    channel?.dispose();
    channel = undefined;
  },
};
