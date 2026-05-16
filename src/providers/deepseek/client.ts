/**
 * DeepSeek API 客户端
 */

import { createApiClient } from '../base/client';
import type { IApiClient } from '../../core/interfaces';

/**
 * 创建 DeepSeek API 客户端
 */
export function createDeepSeekClient(baseUrl: string, apiKey: string): IApiClient {
	return createApiClient({ baseUrl, apiKey, providerName: 'DeepSeek' });
}

/**
 * @deprecated 使用 createDeepSeekClient 代替
 */
export class DeepSeekClient {
	constructor(baseUrl: string, apiKey: string) {
		console.warn('DeepSeekClient is deprecated, use createDeepSeekClient instead');
		return createDeepSeekClient(baseUrl, apiKey) as unknown as DeepSeekClient;
	}
}
