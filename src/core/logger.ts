/**
 * 日志模块
 *
 * 提供分类日志功能，支持多模型提供者的日志输出
 */

import vscode from 'vscode';

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
 * 写入日志消息到输出通道
 */
function write(level: string, category: LogCategory, args: unknown[]): void {
	const text = formatMessage(level, category, args);
	getChannel().appendLine(text);
}

/**
 * 写入带颜色的日志（仅在开发模式下）
 */
function writeColored(level: string, category: LogCategory, args: unknown[]): void {
	const color = CATEGORY_COLORS[category];
	const text = formatMessage(level, category, args);

	// VS Code 输出通道不支持颜色，但控制台支持
	console.log(`${color}${text}${RESET_COLOR}`);

	// 同时写入到输出通道
	getChannel().appendLine(text);
}

/**
 * 设置是否显示分类标签
 */
export function setShowCategory(show: boolean): void {
	showCategory = show;
}

/**
 * 日志记录器导出对象
 */
export const logger = {
	// 核心模块日志
	core: {
		info: (...args: unknown[]) => write('INFO ', 'core', args),
		warn: (...args: unknown[]) => write('WARN ', 'core', args),
		error: (...args: unknown[]) => write('ERROR', 'core', args),
		debug: (...args: unknown[]) => write('DEBUG', 'core', args),
	},

	// 模型注册表日志
	registry: {
		info: (...args: unknown[]) => write('INFO ', 'registry', args),
		warn: (...args: unknown[]) => write('WARN ', 'registry', args),
		error: (...args: unknown[]) => write('ERROR', 'registry', args),
		debug: (...args: unknown[]) => write('DEBUG', 'registry', args),
	},

	// 提供者通用日志
	provider: {
		info: (...args: unknown[]) => write('INFO ', 'provider', args),
		warn: (...args: unknown[]) => write('WARN ', 'provider', args),
		error: (...args: unknown[]) => write('ERROR', 'provider', args),
		debug: (...args: unknown[]) => write('DEBUG', 'provider', args),
	},

	// DeepSeek 提供者日志
	deepseek: {
		info: (...args: unknown[]) => write('INFO ', 'deepseek', args),
		warn: (...args: unknown[]) => write('WARN ', 'deepseek', args),
		error: (...args: unknown[]) => write('ERROR', 'deepseek', args),
		debug: (...args: unknown[]) => write('DEBUG', 'deepseek', args),
	},

	// 认证模块日志
	auth: {
		info: (...args: unknown[]) => write('INFO ', 'auth', args),
		warn: (...args: unknown[]) => write('WARN ', 'auth', args),
		error: (...args: unknown[]) => write('ERROR', 'auth', args),
		debug: (...args: unknown[]) => write('DEBUG', 'auth', args),
	},

	// API 请求日志
	api: {
		info: (...args: unknown[]) => write('INFO ', 'api', args),
		warn: (...args: unknown[]) => write('WARN ', 'api', args),
		error: (...args: unknown[]) => write('ERROR', 'api', args),
		debug: (...args: unknown[]) => write('DEBUG', 'api', args),
	},

	// Chat 会话日志
	chat: {
		info: (...args: unknown[]) => write('INFO ', 'chat', args),
		warn: (...args: unknown[]) => write('WARN ', 'chat', args),
		error: (...args: unknown[]) => write('ERROR', 'chat', args),
		debug: (...args: unknown[]) => write('DEBUG', 'chat', args),
	},

	// 流式处理日志
	stream: {
		info: (...args: unknown[]) => write('INFO ', 'stream', args),
		warn: (...args: unknown[]) => write('WARN ', 'stream', args),
		error: (...args: unknown[]) => write('ERROR', 'stream', args),
		debug: (...args: unknown[]) => write('DEBUG', 'stream', args),
	},

	// 配置日志
	config: {
		info: (...args: unknown[]) => write('INFO ', 'config', args),
		warn: (...args: unknown[]) => write('WARN ', 'config', args),
		error: (...args: unknown[]) => write('ERROR', 'config', args),
		debug: (...args: unknown[]) => write('DEBUG', 'config', args),
	},

	/** 通用日志方法 */
	info: (...args: unknown[]) => write('INFO ', 'core', args),
	warn: (...args: unknown[]) => write('WARN ', 'core', args),
	error: (...args: unknown[]) => write('ERROR', 'core', args),
	debug: (...args: unknown[]) => write('DEBUG', 'core', args),

	/** 显示输出面板 */
	show: () => getChannel().show(),

	/** 隐藏输出面板 */
	hide: () => getChannel().hide(),

	/** 清除日志 */
	clear: () => getChannel().clear(),

	/** 释放资源 */
	dispose: () => {
		channel?.dispose();
		channel = undefined;
	},
};

export default logger;
