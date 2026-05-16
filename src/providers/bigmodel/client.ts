/**
 * BigModel API 客户端
 */

import { BaseApiClient } from '../base/client';

/**
 * BigModel API 客户端实现
 */
export class BigModelClient extends BaseApiClient {
	constructor(baseUrl: string, apiKey: string) {
		super(baseUrl, apiKey);
	}

	protected override getProviderName(): string {
		return 'BigModel';
	}
}
