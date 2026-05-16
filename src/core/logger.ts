/**
 * 日志模块
 *
 * 提供分类日志功能，支持多模型提供者的日志输出
 * 自动区分开发环境（详细日志）和生产环境（精简日志）
 */

import vscode from 'vscode';

/** 日志级别 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/** 日志级别优先级 */
const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
	debug: 0,
	info: 1,
	warn: 2,
	error: 3,
};

// 日志分类
export type LogCategory =
	| 'core'
	| 'registry'
	| 'provider'
	| 'deepseek'
	| 'auth'
	| 'api'
	| 'chat'
	| 'stream'
	| 'config';

// 日志分类显示名称
const CATEGORY_NAMES: Record<LogCategory, string> = {
	core: 'Core',
	registry: 'Registry',
	provider: 'Provider',
	deepseek: 'DeepSeek',
	auth: 'Auth',
	api: 'API',
	chat: 'Chat',
	stream: 'Stream',
	config: 'Config',
};

// 分类颜色（用于控制台输出）
const CATEGORY_COLORS: Record<LogCategory, string> = {
	core: '\x1b[36m', // 青色
	registry: '\x1b[35m', // 紫色
	provider: '\x1b[34m', // 蓝色
	deepseek: '\x1b[33m', // 黄色
	auth: '\x1b[33m', // 黄色
	api: '\x1b[32m', // 绿色
	chat: '\x1b[96m', // 亮青色
	stream: '\x1b[90m', // 灰色
	config: '\x1b[90m', // 灰色
};

const RESET_COLOR = '\x1b[0m';

/** 输出通道实例 */
let channel: vscode.OutputChannel | undefined;

/** 是否显示分类标签 */
let showCategory = true;

/** 当前日志级别 */
let currentLogLevel: LogLevel = 'info';

/** 是否为开发模式 */
let isDevelopmentMode = false;

/**
 * 检测是否为开发模式
 * 开发模式：扩展以 workspace 形式运行（调试时）
 * 生产模式：扩展以安装包形式运行
 *
 * 通过以下方式检测：
 * 1. NODE_ENV=development 环境变量
 * 2. 检查 VSCode 的 URI scheme（开发时为 file，生产时为 vscode）
 */
function detectDevelopmentMode(): boolean {
	try {
		// 检查 NODE_ENV 环境变量
		if (typeof process !== 'undefined' && process.env?.NODE_ENV === 'development') {
			return true;
		}

		// 检查是否在调试模式
		if (typeof process !== 'undefined' && process.env?.NODE_ENV === undefined) {
			// 当 NODE_ENV 未设置时，检查是否为调试环境
			// 可以通过检查全局变量或配置来判断
			const isDebug = typeof (globalThis as Record<string, unknown>)['__vscdebug'] !== 'undefined';
			if (isDebug) { return true; }
		}

		// 默认返回 false（生产模式）
		return false;
	} catch {
		return false;
	}
}

/**
 * 获取默认日志级别
 * 开发模式：debug
 * 生产模式：info
 */
function getDefaultLogLevel(): LogLevel {
	if (isDevelopmentMode) {
		return 'debug';
	}
	return 'info';
}

/** 初始化日志模块 */
function initLogger(): void {
	isDevelopmentMode = detectDevelopmentMode();
	currentLogLevel = getDefaultLogLevel();
}

/** 获取或创建输出通道 */
function getChannel(): vscode.OutputChannel {
	if (!channel) {
		channel = vscode.window.createOutputChannel('Copilot Models');
	}
	return channel;
}

/** 获取当前时间戳字符串 */
function ts(): string {
	return new Date().toISOString().slice(11, 23);
}

/**
 * 格式化日志消息
 */
function formatMessage(level: string, category: LogCategory, args: unknown[]): string {
	const categoryText = showCategory ? `[${CATEGORY_NAMES[category]}] ` : '';
	const prefix = `[${ts()}] [${level}] ${categoryText}`;

	const text = args
		.map((a) => {
			if (typeof a === 'string') {
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
		.join(' ');

	return `${prefix}${text}`;
}

/**
 * 检查是否应该输出此级别的日志
 */
function shouldLog(level: LogLevel): boolean {
	return LOG_LEVEL_PRIORITY[level] >= LOG_LEVEL_PRIORITY[currentLogLevel];
}

/**
 * 写入日志消息到输出通道
 */
function write(level: LogLevel, category: LogCategory, args: unknown[]): void {
	if (!shouldLog(level)) {
		return;
	}

	const levelStr = level.toUpperCase().padEnd(5);
	const text = formatMessage(levelStr, category, args);
	getChannel().appendLine(text);

	// 开发模式下同时输出到控制台
	if (isDevelopmentMode && level === 'debug') {
		const color = CATEGORY_COLORS[category];
		console.log(`${color}${text}${RESET_COLOR}`);
	}
}

/**
 * 设置是否显示分类标签
 */
export function setShowCategory(show: boolean): void {
	showCategory = show;
}

/**
 * 设置日志级别
 * @param level 日志级别
 */
export function setLogLevel(level: LogLevel): void {
	currentLogLevel = level;
}

/**
 * 获取当前日志级别
 */
export function getLogLevel(): LogLevel {
	return currentLogLevel;
}

/**
 * 检查是否为开发模式
 */
export function isDevMode(): boolean {
	return isDevelopmentMode;
}

// 初始化日志模块
initLogger();

/**
 * 日志记录器导出对象
 */
export const logger = {
	// 核心模块日志
	core: {
		info: (...args: unknown[]) => write('info', 'core', args),
		warn: (...args: unknown[]) => write('warn', 'core', args),
		error: (...args: unknown[]) => write('error', 'core', args),
		debug: (...args: unknown[]) => write('debug', 'core', args),
	},

	// 模型注册表日志
	registry: {
		info: (...args: unknown[]) => write('info', 'registry', args),
		warn: (...args: unknown[]) => write('warn', 'registry', args),
		error: (...args: unknown[]) => write('error', 'registry', args),
		debug: (...args: unknown[]) => write('debug', 'registry', args),
	},

	// 提供者通用日志
	provider: {
		info: (...args: unknown[]) => write('info', 'provider', args),
		warn: (...args: unknown[]) => write('warn', 'provider', args),
		error: (...args: unknown[]) => write('error', 'provider', args),
		debug: (...args: unknown[]) => write('debug', 'provider', args),
	},

	// DeepSeek 提供者日志
	deepseek: {
		info: (...args: unknown[]) => write('info', 'deepseek', args),
		warn: (...args: unknown[]) => write('warn', 'deepseek', args),
		error: (...args: unknown[]) => write('error', 'deepseek', args),
		debug: (...args: unknown[]) => write('debug', 'deepseek', args),
	},

	// 认证模块日志
	auth: {
		info: (...args: unknown[]) => write('info', 'auth', args),
		warn: (...args: unknown[]) => write('warn', 'auth', args),
		error: (...args: unknown[]) => write('error', 'auth', args),
		debug: (...args: unknown[]) => write('debug', 'auth', args),
	},

	// API 请求日志
	api: {
		info: (...args: unknown[]) => write('info', 'api', args),
		warn: (...args: unknown[]) => write('warn', 'api', args),
		error: (...args: unknown[]) => write('error', 'api', args),
		debug: (...args: unknown[]) => write('debug', 'api', args),
	},

	// Chat 会话日志
	chat: {
		info: (...args: unknown[]) => write('info', 'chat', args),
		warn: (...args: unknown[]) => write('warn', 'chat', args),
		error: (...args: unknown[]) => write('error', 'chat', args),
		debug: (...args: unknown[]) => write('debug', 'chat', args),
	},

	// 流式处理日志
	stream: {
		info: (...args: unknown[]) => write('info', 'stream', args),
		warn: (...args: unknown[]) => write('warn', 'stream', args),
		error: (...args: unknown[]) => write('error', 'stream', args),
		debug: (...args: unknown[]) => write('debug', 'stream', args),
	},

	// 配置日志
	config: {
		info: (...args: unknown[]) => write('info', 'config', args),
		warn: (...args: unknown[]) => write('warn', 'config', args),
		error: (...args: unknown[]) => write('error', 'config', args),
		debug: (...args: unknown[]) => write('debug', 'config', args),
	},

	/** 通用日志方法 */
	info: (...args: unknown[]) => write('info', 'core', args),
	warn: (...args: unknown[]) => write('warn', 'core', args),
	error: (...args: unknown[]) => write('error', 'core', args),
	debug: (...args: unknown[]) => write('debug', 'core', args),

	/** 显示输出面板 */
	show: () => getChannel().show(),

	/** 隐藏输出面板 */
	hide: () => getChannel().hide(),

	/** 清除日志 */
	clear: () => getChannel().clear(),

	/** 获取/设置日志级别 */
	get level(): LogLevel {
		return currentLogLevel;
	},
	set level(level: LogLevel) {
		currentLogLevel = level;
	},

	/** 释放资源 */
	dispose: () => {
		channel?.dispose();
		channel = undefined;
	},
};

export default logger;
