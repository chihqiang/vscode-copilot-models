/**
 * BigModel API 客户端
 */

import { createApiClient } from '../base/client';
import type { IApiClient } from '../../core/interfaces';

/**
 * 创建 BigModel API 客户端
 */
export function createBigModelClient(baseUrl: string, apiKey: string): IApiClient {
	return createApiClient({ baseUrl, apiKey, providerName: 'BigModel', chatEndpoint: '/chat/completions' });
}
