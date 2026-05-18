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

/** 日志分类 */
export type LogCategory = 'core' | 'registry' | 'provider' | 'auth' | 'api' | 'chat' | 'stream' | 'config';

// 预定义分类的显示名称
const PREDEFINED_CATEGORY_NAMES: Record<Exclude<LogCategory, 'provider'>, string> = {
	core: 'Core',
	registry: 'Registry',
	auth: 'Auth',
	api: 'API',
	chat: 'Chat',
	stream: 'Stream',
	config: 'Config',
};

// 动态注册的 provider 信息
const providerCategories = new Map<string, string>();

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
 */
function detectDevelopmentMode(): boolean {
	try {
		if (typeof process !== 'undefined' && process.env?.NODE_ENV === 'development') {
			return true;
		}
		if (typeof process !== 'undefined' && process.env?.NODE_ENV === undefined) {
			const isDebug = typeof (globalThis as Record<string, unknown>)['__vscdebug'] !== 'undefined';
			if (isDebug) { return true; }
		}
		return false;
	} catch {
		return false;
	}
}

/**
 * 获取默认日志级别
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
 * 获取分类显示名称
 */
function getCategoryName(category: string): string {
	if (category === 'provider') {
		return 'Provider';
	}
	return PREDEFINED_CATEGORY_NAMES[category as keyof typeof PREDEFINED_CATEGORY_NAMES] ?? category;
}

/**
 * 检查是否应该输出此级别的日志
 */
function shouldLog(level: LogLevel): boolean {
	return LOG_LEVEL_PRIORITY[level] >= LOG_LEVEL_PRIORITY[currentLogLevel];
}

/**
 * 惰性格式化日志消息 - 只在需要时才进行格式化
 * 使用闭包延迟计算，避免不必要的字符串拼接和 JSON 序列化
 */
function lazyFormatMessage(level: string, category: string, args: unknown[]): () => string {
	return () => {
		const categoryText = showCategory ? `[${getCategoryName(category)}] ` : '';
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
	};
}

/**
 * 写入日志消息到输出通道 - 惰性求值版本
 * 只在日志级别允许时才进行格式化，避免不必要的性能开销
 */
function write(level: LogLevel, category: string, args: unknown[]): void {
	// 先检查日志级别，避免不必要的格式化
	if (!shouldLog(level)) {
		return;
	}

	const levelStr = level.toUpperCase().padEnd(5);
	const formatFn = lazyFormatMessage(levelStr, category, args);
	const text = formatFn(); // 只在需要时才执行格式化
	getChannel().appendLine(text);

	// 开发模式下同时输出到控制台
	if (isDevelopmentMode && level === 'debug') {
		console.log(text);
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

/**
 * 日志记录器接口
 */
export interface Logger {
	info: (...args: unknown[]) => void;
	warn: (...args: unknown[]) => void;
	error: (...args: unknown[]) => void;
	debug: (...args: unknown[]) => void;
}

/**
 * 创建一个 provider 专用的日志记录器
 * @param providerId 提供商 ID（如 'deepseek', 'bigmodel'）
 * @param providerName 提供商显示名称（如 'DeepSeek', 'BigModel'）
 * @returns 日志记录器
 *
 * @example
 * const logger = createProviderLogger('deepseek', 'DeepSeek');
 * logger.info('消息'); // 输出: [时间] [INFO] [DeepSeek] 消息
 */
export function createProviderLogger(providerId: string, providerName: string): Logger {
	// 注册 provider 分类
	if (!providerCategories.has(providerId)) {
		providerCategories.set(providerId, providerName);
	}

	return {
		info: (...args: unknown[]) => write('info', providerId, args),
		warn: (...args: unknown[]) => write('warn', providerId, args),
		error: (...args: unknown[]) => write('error', providerId, args),
		debug: (...args: unknown[]) => write('debug', providerId, args),
	};
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
