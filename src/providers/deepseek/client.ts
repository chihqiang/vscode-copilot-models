/**
 * DeepSeek API 客户端
 */

import { BaseApiClient } from '../base/client';

/**
 * DeepSeek API 客户端实现
 */
export class DeepSeekClient extends BaseApiClient {
	constructor(baseUrl: string, apiKey: string) {
		super(baseUrl, apiKey);
	}

	protected override getProviderName(): string {
		return 'DeepSeek';
	}
}
