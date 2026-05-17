/**
 * 提供者工厂接口 - 用于动态注册模型提供者
 */

import vscode from 'vscode';

/**
 * 提供者工厂接口
 * 所有模型提供者必须实现此接口以支持动态注册
 */
export interface IProviderFactory {
	/** 提供者 ID (与 vscode.lm.registerLanguageModelChatProvider 的 vendorId 对应) */
	readonly providerId: string;
	/** 提供者显示名称 */
	readonly providerName: string;
	/** 是否启用此提供者 (可通过配置控制) */
	isEnabled(): boolean;
	/** 创建 Chat Provider 实例 */
	createChatProvider(context: vscode.ExtensionContext): vscode.LanguageModelChatProvider;
}

/**
 * 提供者注册表 - 管理所有已注册的使用者工厂
 */
export class ProviderFactoryRegistry {
	private static instance: ProviderFactoryRegistry | undefined;
	private factories: Map<string, IProviderFactory> = new Map();

	private constructor() {}

	static getInstance(): ProviderFactoryRegistry {
		if (!ProviderFactoryRegistry.instance) {
			ProviderFactoryRegistry.instance = new ProviderFactoryRegistry();
		}
		return ProviderFactoryRegistry.instance;
	}

	/**
	 * 重置单例实例 (仅用于测试)
	 * @internal
	 */
	static _resetInstance(): void {
		if (ProviderFactoryRegistry.instance) {
			ProviderFactoryRegistry.instance.clear();
			ProviderFactoryRegistry.instance = undefined;
		}
	}

	/**
	 * 检查实例是否已初始化 (用于测试)
	 * @internal
	 */
	static _isInitialized(): boolean {
		return ProviderFactoryRegistry.instance !== undefined;
	}

	/**
	 * 注册提供者工厂
	 */
	register(factory: IProviderFactory): void {
		if (this.factories.has(factory.providerId)) {
			console.warn(`Provider factory "${factory.providerId}" is already registered, skipping`);
			return;
		}
		this.factories.set(factory.providerId, factory);
		console.info(`Registered provider factory: ${factory.providerId} (${factory.providerName})`);
	}

	/**
	 * 获取已注册的提供者工厂
	 */
	getFactory(providerId: string): IProviderFactory | undefined {
		return this.factories.get(providerId);
	}

	/**
	 * 获取所有已启用的提供者工厂
	 */
	getEnabledFactories(): IProviderFactory[] {
		return Array.from(this.factories.values()).filter((f) => f.isEnabled());
	}

	/**
	 * 获取所有已注册工厂
	 */
	getAllFactories(): IProviderFactory[] {
		return Array.from(this.factories.values());
	}

	/**
	 * 检查是否已注册
	 */
	has(providerId: string): boolean {
		return this.factories.has(providerId);
	}

	/**
	 * 获取已注册数量
	 */
	get count(): number {
		return this.factories.size;
	}

	/**
	 * 清空注册表
	 */
	clear(): void {
		this.factories.clear();
	}
}

/**
 * 提供者注册装饰器 - 用于自动注册提供者工厂
 */
export function registerProvider(providerId: string, providerName: string) {
	return function <
		T extends new (context: import('vscode').ExtensionContext) => ReturnType<IProviderFactory['createChatProvider']>,
	>(target: T, _context: ClassFieldDecoratorContext): T {
		// 在模块加载时自动注册
		const factory: IProviderFactory = {
			providerId,
			providerName,
			isEnabled: () => true,
			createChatProvider: (context: import('vscode').ExtensionContext) => new target(context),
		};

		// 延迟注册，确保 Registry 已初始化
		if (typeof process !== 'undefined' && process.env?.NODE_ENV !== 'test') {
			queueMicrotask(() => {
				ProviderFactoryRegistry.getInstance().register(factory);
			});
		}

		return target;
	};
}

/**
 * ProviderFactory 配置
 */
export interface ProviderFactoryConfig {
	providerId: string;
	providerName: string;
	configSection: string;
	enabledByDefault?: boolean;
	createChatProvider: (context: vscode.ExtensionContext) => vscode.LanguageModelChatProvider;
}

/**
 * 创建 ProviderFactory 的辅助函数
 * 用于减少重复代码
 */
export function createProviderFactory(config: ProviderFactoryConfig): IProviderFactory {
	const { providerId, providerName, configSection, enabledByDefault = true, createChatProvider } = config;

	return {
		providerId,
		providerName,
		isEnabled: () => {
			const cfg = vscode.workspace.getConfiguration(configSection);
			return cfg.get<boolean>('enabled', enabledByDefault);
		},
		createChatProvider,
	};
}

/**
 * 创建 ProviderFactory 注册函数的辅助函数
 */
export function createProviderFactoryRegister(config: ProviderFactoryConfig) {
	const factory = createProviderFactory(config);

	return {
		factory,
		register: () => {
			ProviderFactoryRegistry.getInstance().register(factory);
		},
	};
}
