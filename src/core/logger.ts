/**
 * 日志系统
 *
 * 提供分级日志输出到 VS Code OutputChannel，支持：
 * - 4 级日志：debug / info / warn / error
 * - 9 种分类：core / registry / provider / auth / api / chat / stream / config / router
 * - 自动清理：超过 10000 行自动清空
 * - 热重载：跟随 copilot-models.debugMode 配置变化
 * - 开发模式下 debug 级别同时输出到 console.log
 */

import vscode from 'vscode';
import { isDevelopmentEnvironment } from './env';

/** 日志级别 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/** 日志级别优先级（数字越大越重要） */
const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

/** debugMode 配置值到日志级别的映射 */
const DEBUG_MODE_MAP: Record<string, LogLevel> = {
  minimal: 'warn',
  metadata: 'info',
  verbose: 'debug',
};

/** 日志分类 */
export type LogCategory =
  | 'core' | 'registry' | 'provider' | 'auth'
  | 'api' | 'chat' | 'stream' | 'config' | 'router';

/** 分类显示名映射 */
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

/** 自动清理阈值 */
const MAX_LOG_LINES = 10000;

let channel: vscode.OutputChannel | undefined;
let showCategory = true;
let currentLogLevel: LogLevel = 'info';
let isDevelopmentMode = false;
let lineCount = 0;

/** VS Code 配置 section */
const CONFIG_SECTION = 'copilot-models';

/** 获取默认日志级别（开发模式为 debug，否则 info） */
function getDefaultLogLevel(): LogLevel {
  return isDevelopmentMode ? 'debug' : 'info';
}

/** 从 VS Code 配置读取 debugMode 并应用对应日志级别 */
export function applyLogLevelFromConfig(): void {
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

/** 初始化日志系统，根据扩展运行模式设置默认级别 */
export function initLogger(context: vscode.ExtensionContext): void {
  isDevelopmentMode = context.extensionMode === vscode.ExtensionMode.Development
    || isDevelopmentEnvironment()
    || context.extensionMode === vscode.ExtensionMode.Test;
  currentLogLevel = getDefaultLogLevel();
  applyLogLevelFromConfig();
}

/** 获取或创建 OutputChannel */
function getChannel(): vscode.OutputChannel {
  if (!channel) {
    channel = vscode.window.createOutputChannel('Copilot Models');
  }
  return channel;
}

/** 获取 HH:MM:SS.mmm 时间戳 */
function ts(): string {
  return new Date().toISOString().slice(11, 23);
}

/** 获取分类显示名 */
function getCategoryName(category: string): string {
  return CATEGORY_NAMES[category as LogCategory] ?? category;
}

/** 判断当前级别是否应该输出 */
export function shouldLog(level: LogLevel): boolean {
  return LOG_LEVEL_PRIORITY[level] >= LOG_LEVEL_PRIORITY[currentLogLevel];
}

/** 懒格式化消息（仅在输出时拼接字符串，避免无谓的性能开销） */
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

/** 检查行数是否超限，超限则清空 OutputChannel */
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

/** 写入日志到 OutputChannel */
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

/** 日志接口（4 个级别的方法） */
export interface Logger {
  info: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
  debug: (...args: unknown[]) => void;
}

/** 创建分类日志记录器 */
function createCategoryLogger(category: LogCategory): Logger {
  return {
    info: (...args: unknown[]) => write('info', category, args),
    warn: (...args: unknown[]) => write('warn', category, args),
    error: (...args: unknown[]) => write('error', category, args),
    debug: (...args: unknown[]) => write('debug', category, args),
  };
}

/** 为指定 provider 创建带分类标签的日志记录器 */
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
