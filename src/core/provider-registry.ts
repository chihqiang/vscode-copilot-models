/**
 * Provider factory interface - for dynamic model provider registration
 */

import vscode from 'vscode';
import type { IChatProvider } from './chat-provider';
import { logger } from './logger';
import { isTestEnvironment } from './env';

/**
 * Provider factory interface
 * All model providers must implement this interface for dynamic registration
 */
export interface IProviderFactory {
	/** Provider ID (corresponds to vendorId in vscode.lm.registerLanguageModelChatProvider) */
	readonly providerId: string;
	/** Provider display name */
	readonly providerName: string;
	/** Whether this provider is enabled (configurable) */
	isEnabled(): boolean;
	/** Create Chat Provider instance */
	createChatProvider(context: vscode.ExtensionContext): IChatProvider;
}

/**
 * Provider factory registry - manages all registered provider factories
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
	 * Reset singleton instance (for testing only)
	 * @internal
	 */
	static _resetInstance(): void {
		if (ProviderFactoryRegistry.instance) {
			ProviderFactoryRegistry.instance.clear();
			ProviderFactoryRegistry.instance = undefined;
		}
	}

	/**
	 * Check if instance is initialized (for testing)
	 * @internal
	 */
	static _isInitialized(): boolean {
		return ProviderFactoryRegistry.instance !== undefined;
	}

	/**
	 * Register provider factory
	 */
	register(factory: IProviderFactory): void {
		if (this.factories.has(factory.providerId)) {
			logger.provider.debug(`Provider factory "${factory.providerId}" is already registered, skipping`);
			return;
		}
		this.factories.set(factory.providerId, factory);
		logger.provider.debug(`Registered provider factory: ${factory.providerId}`);
	}

	/**
	 * Get registered provider factory
	 */
	getFactory(providerId: string): IProviderFactory | undefined {
		return this.factories.get(providerId);
	}

	/**
	 * Get all enabled provider factories
	 */
	getEnabledFactories(): IProviderFactory[] {
		return Array.from(this.factories.values()).filter((f) => f.isEnabled());
	}

	/**
	 * Get all registered factories
	 */
	getAllFactories(): IProviderFactory[] {
		return Array.from(this.factories.values());
	}

	/**
	 * Check if registered
	 */
	has(providerId: string): boolean {
		return this.factories.has(providerId);
	}

	/**
	 * Get registration count
	 */
	get count(): number {
		return this.factories.size;
	}

	/**
	 * Clear registry
	 */
	clear(): void {
		this.factories.clear();
	}
}

/**
 * Provider registration decorator - for auto-registering provider factories
 */
export function registerProvider(providerId: string, providerName: string) {
	return function <
		T extends new (context: import('vscode').ExtensionContext) => ReturnType<IProviderFactory['createChatProvider']>,
	>(target: T, _context: ClassFieldDecoratorContext): T {
		// Auto-register on module load
		const factory: IProviderFactory = {
			providerId,
			providerName,
			isEnabled: () => true,
			createChatProvider: (context: import('vscode').ExtensionContext) => new target(context),
		};

		// Defer registration to ensure Registry is initialized
		if (!isTestEnvironment()) {
			queueMicrotask(() => {
				ProviderFactoryRegistry.getInstance().register(factory);
			});
		}

		return target;
	};
}

/**
 * ProviderFactory configuration
 */
export interface ProviderFactoryConfig {
	providerId: string;
	providerName: string;
	configSection: string;
	enabledByDefault?: boolean;
	createChatProvider: (context: vscode.ExtensionContext) => IChatProvider;
}

/**
 * Helper function to create ProviderFactory
 * Reduces boilerplate code
 */
export function createProviderFactory(config: ProviderFactoryConfig): IProviderFactory {
	const { providerId, providerName, configSection, enabledByDefault = true, createChatProvider } = config;

	return {
		providerId,
		providerName,
		isEnabled: () => {
			const cfg = vscode.workspace.getConfiguration(configSection);
			return cfg.get<boolean>(`${providerId}.enabled`, enabledByDefault);
		},
		createChatProvider,
	};
}

/**
 * Helper function to create ProviderFactory registration function
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
