/**
 * 基础认证管理器 - 通过 VS Code SecretStorage 安全地管理 API 密钥
 */

import vscode from 'vscode';
import { CONFIG_SECTION } from './models';
import { logger } from './logger';

/**
 * 认证管理器接口
 */
export interface IAuthManager {
	/** 获取 API 密钥 */
	getApiKey(): Promise<string | undefined>;
	/** 检查是否已配置 API 密钥 */
	hasApiKey(): Promise<boolean>;
	/** 存储 API 密钥 */
	setApiKey(apiKey: string): Promise<void>;
	/** 删除 API 密钥 */
	deleteApiKey(): Promise<void>;
}

/**
 * 基础认证管理器实现
 * 安全性：API 密钥仅存储在 VS Code SecretStorage 中，不支持明文配置回退
 */
export class BaseAuthManager implements IAuthManager {
	protected readonly secretStorage: vscode.SecretStorage;
	protected readonly secretKey: string;
	protected readonly providerId: string;

	constructor(
		context: vscode.ExtensionContext,
		configSection: string = CONFIG_SECTION,
		providerId: string,
	) {
		this.secretStorage = context.secrets;
		this.providerId = providerId;
		this.secretKey = `${configSection}.${providerId}.apiKey`;
		logger.auth.debug(`[${providerId}] AuthManager initialized`);
	}

	/**
	 * 获取 API 密钥（仅从 SecretStorage 获取）
	 */
	async getApiKey(): Promise<string | undefined> {
		logger.auth.debug(`[${this.providerId}] Getting API key...`);

		const apiKey = await this.secretStorage.get(this.secretKey);
		if (apiKey) {
			logger.auth.debug(`[${this.providerId}] API key found`);
			return apiKey;
		}

		logger.auth.debug(`[${this.providerId}] No API key found`);
		return undefined;
	}

	/**
	 * 检查是否已配置 API 密钥
	 */
	async hasApiKey(): Promise<boolean> {
		const key = await this.getApiKey();
		const has = key !== undefined && key.length > 0;
		logger.auth.debug(`[${this.providerId}] hasApiKey: ${has}`);
		return has;
	}

	/**
	 * 在 SecretStorage 中存储 API 密钥
	 */
	async setApiKey(apiKey: string): Promise<void> {
			logger.auth.debug(`[${this.providerId}] Storing API key...`);
		await this.secretStorage.store(this.secretKey, apiKey.trim());
			logger.auth.debug(`[${this.providerId}] API key stored successfully`);
	}

	/**
	 * 删除已存储的 API 密钥
	 */
	async deleteApiKey(): Promise<void> {
			logger.auth.debug(`[${this.providerId}] Deleting API key...`);
		await this.secretStorage.delete(this.secretKey);
			logger.auth.debug(`[${this.providerId}] API key deleted`);
	}

	/**
	 * 通过输入框提示用户输入 API 密钥
	 */
	async promptForApiKey(prompt: string, placeholder: string): Promise<boolean> {
		logger.auth.info(`[${this.providerId}] Prompting for API key...`);

		const apiKey = await vscode.window.showInputBox({
			prompt,
			placeHolder: placeholder,
			password: true,
			ignoreFocusOut: true,
			validateInput: (value: string) => {
				if (!value?.trim()) {
					return 'API key cannot be empty';
				}
				return undefined;
			},
		});

		if (apiKey) {
			await this.setApiKey(apiKey);
			logger.auth.info(`[${this.providerId}] API key saved`);
			return true;
		}

		logger.auth.info(`[${this.providerId}] User cancelled API key input`);
		return false;
	}
}
