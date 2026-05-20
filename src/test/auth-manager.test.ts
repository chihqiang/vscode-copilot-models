import * as assert from 'assert';
import type { IAuthManager } from '../core/auth-manager';

suite('IAuthManager Interface', () => {
	test('should define all required methods', () => {
		const authManager: IAuthManager = {
			getApiKey: async () => 'sk-test123',
			hasApiKey: async () => true,
			setApiKey: async () => {},
			deleteApiKey: async () => {},
		};

		assert.strictEqual(typeof authManager.getApiKey, 'function');
		assert.strictEqual(typeof authManager.hasApiKey, 'function');
		assert.strictEqual(typeof authManager.setApiKey, 'function');
		assert.strictEqual(typeof authManager.deleteApiKey, 'function');
	});

	test('getApiKey should return string or undefined', async () => {
		const authManager: IAuthManager = {
			getApiKey: async () => 'sk-test',
			hasApiKey: async () => true,
			setApiKey: async () => {},
			deleteApiKey: async () => {},
		};

		const result = await authManager.getApiKey();
		assert.strictEqual(typeof result, 'string');
		assert.strictEqual(result, 'sk-test');
	});

	test('getApiKey should support returning undefined', async () => {
		const authManager: IAuthManager = {
			getApiKey: async () => undefined,
			hasApiKey: async () => false,
			setApiKey: async () => {},
			deleteApiKey: async () => {},
		};

		const result = await authManager.getApiKey();
		assert.strictEqual(result, undefined);
	});

	test('hasApiKey should return boolean', async () => {
		const authManager: IAuthManager = {
			getApiKey: async () => 'sk-test',
			hasApiKey: async () => true,
			setApiKey: async () => {},
			deleteApiKey: async () => {},
		};

		const result = await authManager.hasApiKey();
		assert.strictEqual(typeof result, 'boolean');
		assert.strictEqual(result, true);
	});

	test('hasApiKey should return false when no api key', async () => {
		const authManager: IAuthManager = {
			getApiKey: async () => undefined,
			hasApiKey: async () => false,
			setApiKey: async () => {},
			deleteApiKey: async () => {},
		};

		const result = await authManager.hasApiKey();
		assert.strictEqual(result, false);
	});

	test('setApiKey should accept string parameter', async () => {
		const storedKey: string[] = [];
		const authManager: IAuthManager = {
			getApiKey: async () => storedKey[0],
			hasApiKey: async () => storedKey.length > 0,
			setApiKey: async (apiKey: string) => {
				storedKey[0] = apiKey;
			},
			deleteApiKey: async () => {
				storedKey.length = 0;
			},
		};

		await authManager.setApiKey('sk-new-key');
		const result = await authManager.getApiKey();
		assert.strictEqual(result, 'sk-new-key');
	});

	test('deleteApiKey should remove stored key', async () => {
		const storedKey: string[] = ['sk-existing'];
		const authManager: IAuthManager = {
			getApiKey: async () => storedKey[0],
			hasApiKey: async () => storedKey.length > 0 && storedKey[0]?.length > 0,
			setApiKey: async (apiKey: string) => {
				storedKey[0] = apiKey;
			},
			deleteApiKey: async () => {
				storedKey.length = 0;
			},
		};

		assert.strictEqual(await authManager.hasApiKey(), true);
		await authManager.deleteApiKey();
		assert.strictEqual(await authManager.hasApiKey(), false);
		assert.strictEqual(await authManager.getApiKey(), undefined);
	});

	test('setApiKey should trim the api key', async () => {
		const storedKey: string[] = [];
		const authManager: IAuthManager = {
			getApiKey: async () => storedKey[0],
			hasApiKey: async () => storedKey.length > 0,
			setApiKey: async (apiKey: string) => {
				storedKey[0] = apiKey.trim();
			},
			deleteApiKey: async () => {
				storedKey.length = 0;
			},
		};

		await authManager.setApiKey('  sk-with-spaces  ');
		const result = await authManager.getApiKey();
		assert.strictEqual(result, 'sk-with-spaces');
	});

	test('hasApiKey should return false for empty string', async () => {
		const authManager: IAuthManager = {
			getApiKey: async () => '',
			hasApiKey: async () => false,
			setApiKey: async () => {},
			deleteApiKey: async () => {},
		};

		const result = await authManager.hasApiKey();
		assert.strictEqual(result, false);
	});
});