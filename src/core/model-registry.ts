/**
 * Model Registry - Manage all registered model providers and model definitions
 */

import type {ModelDefinition } from './models';
import { logger } from './logger';
import { IModelProvider } from './model-provider';

/**
 * Global model registry
 */
export class ModelRegistry {
	private static instance: ModelRegistry | undefined;
	private providers: Map<string, IModelProvider> = new Map();
	private models: Map<string, ModelDefinition[]> = new Map();

	private constructor() {
		logger.registry.debug('ModelRegistry initialized');
	}

	/**
	 * Get singleton instance
	 */
	static getInstance(): ModelRegistry {
		if (!ModelRegistry.instance) {
			ModelRegistry.instance = new ModelRegistry();
		}
		return ModelRegistry.instance;
	}

	/**
	 * Reset singleton instance (for testing only)
	 * @internal
	 */
	static _resetInstance(): void {
		if (ModelRegistry.instance) {
			ModelRegistry.instance.clear();
			ModelRegistry.instance = undefined;
			logger.registry.debug('ModelRegistry instance reset');
		}
	}

	/**
	 * Check if instance is initialized (for testing)
	 * @internal
	 */
	static _isInitialized(): boolean {
		return ModelRegistry.instance !== undefined;
	}

	/**
	 * Register model provider
	 */
	registerProvider(provider: IModelProvider): void {
		if (this.providers.has(provider.id)) {
			logger.registry.warn(`Provider "${provider.id}" is already registered, skipping`);
			return;
		}
		const models = provider.getModels();
		this.providers.set(provider.id, provider);
		this.models.set(provider.id, models);
		logger.registry.debug(`Registered provider: ${provider.id} with ${models.length} models`);

		for (const model of models) {
			logger.registry.debug(`  - Model: ${model.id} (${model.family})`);
		}
	}

	/**
	 * Unregister model provider
	 */
	unregisterProvider(providerId: string): void {
		if (this.providers.delete(providerId)) {
			this.models.delete(providerId);
			logger.registry.debug(`Unregistered provider: ${providerId}`);
		} else {
			logger.registry.warn(`Provider "${providerId}" not found, cannot unregister`);
		}
	}

	/**
	 * Get provider
	 */
	getProvider(providerId: string): IModelProvider | undefined {
		const provider = this.providers.get(providerId);
		if (!provider) {
			logger.registry.debug(`Provider "${providerId}" not found`);
		}
		return provider;
	}

	/**
	 * Get all providers
	 */
	getAllProviders(): IModelProvider[] {
		const providers = Array.from(this.providers.values());
		logger.registry.debug(`Getting all providers, count: ${providers.length}`);
		return providers;
	}

	/**
	 * Get provider's model list
	 */
	getModelsForProvider(providerId: string): ModelDefinition[] {
		const models = this.models.get(providerId) || [];
		logger.registry.debug(`Getting models for provider "${providerId}", count: ${models.length}`);
		return models;
	}

	/**
	 * Get all models
	 */
	getAllModels(): ModelDefinition[] {
		const allModels: ModelDefinition[] = [];
		for (const models of this.models.values()) {
			allModels.push(...models);
		}
		logger.registry.debug(`Getting all models, total count: ${allModels.length}`);
		return allModels;
	}

	/**
	 * Find model definition by model ID
	 */
	findModelById(modelId: string): ModelDefinition | undefined {
		for (const models of this.models.values()) {
			const found = models.find((m) => m.id === modelId);
			if (found) {
				logger.registry.debug(`Found model by id "${modelId}": ${found.name}`);
				return found;
			}
		}
		logger.registry.debug(`Model not found by id "${modelId}"`);
		return undefined;
	}

	/**
	 * Find provider by model ID
	 */
	findProviderByModelId(modelId: string): IModelProvider | undefined {
		for (const [providerId, models] of this.models.entries()) {
			if (models.some((m) => m.id === modelId)) {
				const provider = this.providers.get(providerId);
				logger.registry.debug(`Found provider "${providerId}" for model "${modelId}"`);
				return provider;
			}
		}
		logger.registry.debug(`Provider not found for model "${modelId}"`);
		return undefined;
	}

	/**
	 * Check if any provider is registered
	 */
	hasProviders(): boolean {
		return this.providers.size > 0;
	}

	/**
	 * Clear all registrations
	 */
	clear(): void {
		const count = this.providers.size;
		this.providers.clear();
		this.models.clear();
		logger.registry.debug(`Cleared all providers, count: ${count}`);
	}
}
