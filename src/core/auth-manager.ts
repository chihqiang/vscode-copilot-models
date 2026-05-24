/**
 * Base Auth Manager - Securely manage API keys via VS Code SecretStorage
 */

import vscode from 'vscode';
import { CONFIG_SECTION } from './models';
import { logger } from './logger';

/**
 * Auth manager interface
 */
export interface IAuthManager {
	/** Get API key */
	getApiKey(): Promise<string | undefined>;
	/** Check if API key is configured */
	hasApiKey(): Promise<boolean>;
	/** Store API key */
	setApiKey(apiKey: string): Promise<void>;
	/** Delete API key */
	deleteApiKey(): Promise<void>;
}

/**
 * Base Auth Manager implementation
 * Security: API keys are stored only in VS Code SecretStorage, no plaintext fallback
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
	 * Get API key (from SecretStorage only)
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
	 * Check if API key is configured
	 */
	async hasApiKey(): Promise<boolean> {
		const key = await this.getApiKey();
		const has = key !== undefined && key.length > 0;
		logger.auth.debug(`[${this.providerId}] hasApiKey: ${has}`);
		return has;
	}

	/**
	 * Store API key in SecretStorage
	 */
	async setApiKey(apiKey: string): Promise<void> {
			logger.auth.debug(`[${this.providerId}] Storing API key...`);
		await this.secretStorage.store(this.secretKey, apiKey.trim());
			logger.auth.debug(`[${this.providerId}] API key stored successfully`);
	}

	/**
	 * Delete stored API key
	 */
	async deleteApiKey(): Promise<void> {
			logger.auth.debug(`[${this.providerId}] Deleting API key...`);
		await this.secretStorage.delete(this.secretKey);
			logger.auth.debug(`[${this.providerId}] API key deleted`);
	}

	/**
	 * Prompt user to input API key via input box
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
