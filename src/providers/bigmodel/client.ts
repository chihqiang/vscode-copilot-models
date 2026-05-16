/**
 * BigModel API 客户端
 */

import { createApiClient } from '../base/client';
import type { IApiClient } from '../../core/interfaces';

/**
 * 创建 BigModel API 客户端
 */
export function createBigModelClient(baseUrl: string, apiKey: string): IApiClient {
	return createApiClient({ baseUrl, apiKey, providerName: 'BigModel' });
}

/**
 * @deprecated 使用 createBigModelClient 代替
 */
export class BigModelClient {
	constructor(baseUrl: string, apiKey: string) {
		console.warn('BigModelClient is deprecated, use createBigModelClient instead');
		return createBigModelClient(baseUrl, apiKey) as unknown as BigModelClient;
	}
}
