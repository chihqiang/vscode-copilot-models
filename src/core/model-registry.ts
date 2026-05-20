/**
 * 模型注册表 - 管理所有注册的模型提供商和模型定义
 */

import type {ModelDefinition } from './models';
import { logger } from './logger';
import { IModelProvider } from './model-provider';

/**
 * 全局模型注册表
 */
export class ModelRegistry {
	private static instance: ModelRegistry | undefined;
	private providers: Map<string, IModelProvider> = new Map();
	private models: Map<string, ModelDefinition[]> = new Map();

	private constructor() {
		logger.registry.debug('ModelRegistry initialized');
	}

	/**
	 * 获取单例实例
	 */
	static getInstance(): ModelRegistry {
		if (!ModelRegistry.instance) {
			ModelRegistry.instance = new ModelRegistry();
		}
		return ModelRegistry.instance;
	}

	/**
	 * 重置单例实例 (仅用于测试)
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
	 * 检查实例是否已初始化 (用于测试)
	 * @internal
	 */
	static _isInitialized(): boolean {
		return ModelRegistry.instance !== undefined;
	}

	/**
	 * 注册模型提供商
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
	 * 注销模型提供商
	 */
	unregisterProvider(providerId: string): void {
		if (this.providers.delete(providerId)) {
			this.models.delete(providerId);
			logger.registry.info(`Unregistered provider: ${providerId}`);
		} else {
			logger.registry.warn(`Provider "${providerId}" not found, cannot unregister`);
		}
	}

	/**
	 * 获取提供商
	 */
	getProvider(providerId: string): IModelProvider | undefined {
		const provider = this.providers.get(providerId);
		if (!provider) {
			logger.registry.debug(`Provider "${providerId}" not found`);
		}
		return provider;
	}

	/**
	 * 获取所有提供商
	 */
	getAllProviders(): IModelProvider[] {
		const providers = Array.from(this.providers.values());
		logger.registry.debug(`Getting all providers, count: ${providers.length}`);
		return providers;
	}

	/**
	 * 获取提供商的模型列表
	 */
	getModelsForProvider(providerId: string): ModelDefinition[] {
		const models = this.models.get(providerId) || [];
		logger.registry.debug(`Getting models for provider "${providerId}", count: ${models.length}`);
		return models;
	}

	/**
	 * 获取所有模型
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
	 * 根据模型 ID 查找模型定义
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
	 * 根据模型 ID 查找所属的提供商
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
	 * 检查是否有任何提供商已注册
	 */
	hasProviders(): boolean {
		return this.providers.size > 0;
	}

	/**
	 * 清空所有注册
	 */
	clear(): void {
		const count = this.providers.size;
		this.providers.clear();
		this.models.clear();
		logger.registry.info(`Cleared all providers, count: ${count}`);
	}
}
