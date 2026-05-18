/**
 * DeepSeek API 客户端
 */

import { createApiClient } from '../base/client';
import type { IApiClient } from '../../core/interfaces';

/**
 * 创建 DeepSeek API 客户端
 */
export function createDeepSeekClient(baseUrl: string, apiKey: string): IApiClient {
	return createApiClient({ baseUrl, apiKey, providerName: 'DeepSeek', chatEndpoint: '/chat/completions' });
}
