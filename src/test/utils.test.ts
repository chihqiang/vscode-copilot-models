import * as assert from 'assert';

suite('Utility Functions Test Suite', () => {
	suite('safeStringify', () => {
		// Inline safeStringify for testing (copied from client.ts)
		function safeStringify(obj: unknown): string {
			return JSON.stringify(obj, (_, value) => {
				if (typeof value === 'object' && value !== null && !(value instanceof Array)) {
					if (value instanceof Map) {
						return Object.fromEntries(value);
					}
				}
				return value;
			});
		}

		test('should stringify basic objects', () => {
			const obj = { name: 'test', value: 123 };
			const result = safeStringify(obj);
			assert.strictEqual(result, '{"name":"test","value":123}');
		});

		test('should stringify arrays correctly', () => {
			const arr = [1, 2, 3, 'test'];
			const result = safeStringify(arr);
			assert.strictEqual(result, '[1,2,3,"test"]');
		});

		test('should handle nested objects', () => {
			const obj = { nested: { value: 'test' }, arr: [1, 2] };
			const result = safeStringify(obj);
			assert.strictEqual(result, '{"nested":{"value":"test"},"arr":[1,2]}');
		});

		test('should convert Map to object', () => {
			const map = new Map<string, number>();
			map.set('a', 1);
			map.set('b', 2);
			const obj = { map };
			const result = safeStringify(obj);
			assert.strictEqual(result, '{"map":{"a":1,"b":2}}');
		});

		test('should handle null values', () => {
			const obj = { value: null, name: 'test' };
			const result = safeStringify(obj);
			assert.strictEqual(result, '{"value":null,"name":"test"}');
		});

		test('should handle boolean and number values', () => {
			const obj = { bool: true, num: 42, float: 3.14 };
			const result = safeStringify(obj);
			assert.strictEqual(result, '{"bool":true,"num":42,"float":3.14}');
		});

		test('should handle empty objects', () => {
			const obj = {};
			const result = safeStringify(obj);
			assert.strictEqual(result, '{}');
		});

		test('should handle empty arrays', () => {
			const arr: number[] = [];
			const result = safeStringify(arr);
			assert.strictEqual(result, '[]');
		});

		test('should NOT convert arrays with length property to objects', () => {
			const arr = [1, 2, 3];
			const result = safeStringify(arr);
			// Should be array, not object
			assert.strictEqual(result, '[1,2,3]');
			// Verify it's a valid JSON array
			const parsed = JSON.parse(result);
			assert.ok(Array.isArray(parsed));
		});
	});

	suite('sanitizeForLog', () => {
		// Inline sanitizeForLog for testing
		function isSensitiveKey(key: string): boolean {
			const sensitivePatterns = [
				'apikey',
				'api_key',
				'authorization',
				'bearer',
				'password',
				'token',
				'secret',
			];
			const lowerKey = key.toLowerCase();
			return sensitivePatterns.some((pattern) => lowerKey.includes(pattern));
		}

		function sanitizeForLog(obj: unknown): unknown {
			if (typeof obj !== 'object' || obj === null) {
				return obj;
			}

			if (Array.isArray(obj)) {
				return obj.map(sanitizeForLog);
			}

			const result: Record<string, unknown> = {};
			for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
				if (isSensitiveKey(key)) {
					result[key] = '[REDACTED]';
				} else if (typeof value === 'object' && value !== null) {
					result[key] = sanitizeForLog(value);
				} else {
					result[key] = value;
				}
			}
			return result;
		}

		test('should redact apiKey', () => {
			const obj = { apiKey: 'sk-xxx', name: 'test' };
			const result = sanitizeForLog(obj) as Record<string, unknown>;
			assert.strictEqual(result.apiKey, '[REDACTED]');
			assert.strictEqual(result.name, 'test');
		});

		test('should redact api_key', () => {
			const obj = { api_key: 'secret', value: 123 };
			const result = sanitizeForLog(obj) as Record<string, unknown>;
			assert.strictEqual(result.api_key, '[REDACTED]');
		});

		test('should redact authorization header', () => {
			const obj = { authorization: 'Bearer token123', name: 'test' };
			const result = sanitizeForLog(obj) as Record<string, unknown>;
			assert.strictEqual(result.authorization, '[REDACTED]');
		});

		test('should redact password', () => {
			const obj = { password: 'secret123', username: 'admin' };
			const result = sanitizeForLog(obj) as Record<string, unknown>;
			assert.strictEqual(result.password, '[REDACTED]');
			assert.strictEqual(result.username, 'admin');
		});

		test('should redact token', () => {
			const obj = { token: 'abc123', data: 'visible' };
			const result = sanitizeForLog(obj) as Record<string, unknown>;
			assert.strictEqual(result.token, '[REDACTED]');
			assert.strictEqual(result.data, 'visible');
		});

		test('should redact secret', () => {
			const obj = { secret: 'hidden', public: 'visible' };
			const result = sanitizeForLog(obj) as Record<string, unknown>;
			assert.strictEqual(result.secret, '[REDACTED]');
		});

		test('should redact nested sensitive keys', () => {
			const obj = {
				user: {
					name: 'John',
					apiKey: 'sk-secret',
				},
			};
			const result = sanitizeForLog(obj) as { user: Record<string, unknown> };
			assert.strictEqual(result.user.name, 'John');
			assert.strictEqual(result.user.apiKey, '[REDACTED]');
		});

		test('should handle arrays', () => {
			const obj = {
				users: [
					{ name: 'Alice', apiKey: 'key1' },
					{ name: 'Bob', apiKey: 'key2' },
				],
			};
			const result = sanitizeForLog(obj) as { users: Array<Record<string, unknown>> };
			assert.strictEqual(result.users[0].name, 'Alice');
			assert.strictEqual(result.users[0].apiKey, '[REDACTED]');
			assert.strictEqual(result.users[1].name, 'Bob');
			assert.strictEqual(result.users[1].apiKey, '[REDACTED]');
		});

		test('should return primitive values unchanged', () => {
			assert.strictEqual(sanitizeForLog('string'), 'string');
			assert.strictEqual(sanitizeForLog(123), 123);
			assert.strictEqual(sanitizeForLog(true), true);
			assert.strictEqual(sanitizeForLog(null), null);
		});

		test('should handle empty objects', () => {
			const result = sanitizeForLog({});
			assert.deepStrictEqual(result, {});
		});

		test('should handle empty arrays', () => {
			const result = sanitizeForLog([]);
			assert.deepStrictEqual(result, []);
		});

		test('should redact Bearer authorization', () => {
			const obj = { bearer: 'token123' };
			const result = sanitizeForLog(obj) as Record<string, unknown>;
			assert.strictEqual(result.bearer, '[REDACTED]');
		});

		test('should be case-insensitive for patterns', () => {
			const obj = { APIKEY: 'secret', TOKEN: 'abc', PASSWORD: 'pass' };
			const result = sanitizeForLog(obj) as Record<string, unknown>;
			assert.strictEqual(result.APIKEY, '[REDACTED]');
			assert.strictEqual(result.TOKEN, '[REDACTED]');
			assert.strictEqual(result.PASSWORD, '[REDACTED]');
		});
	});

	suite('isSensitiveKey', () => {
		function isSensitiveKey(key: string): boolean {
			const sensitivePatterns = [
				'apikey',
				'api_key',
				'authorization',
				'bearer',
				'password',
				'token',
				'secret',
			];
			const lowerKey = key.toLowerCase();
			return sensitivePatterns.some((pattern) => lowerKey.includes(pattern));
		}

		test('should identify apiKey as sensitive', () => {
			assert.strictEqual(isSensitiveKey('apiKey'), true);
			assert.strictEqual(isSensitiveKey('APIKEY'), true);
			assert.strictEqual(isSensitiveKey('apiKeyValue'), true);
		});

		test('should identify api_key as sensitive', () => {
			assert.strictEqual(isSensitiveKey('api_key'), true);
			assert.strictEqual(isSensitiveKey('deepseekApiKey'), true);
		});

		test('should identify password as sensitive', () => {
			assert.strictEqual(isSensitiveKey('password'), true);
			assert.strictEqual(isSensitiveKey('userPassword'), true);
		});

		test('should identify token as sensitive', () => {
			assert.strictEqual(isSensitiveKey('token'), true);
			assert.strictEqual(isSensitiveKey('accessToken'), true);
		});

		test('should identify secret as sensitive', () => {
			assert.strictEqual(isSensitiveKey('secret'), true);
			assert.strictEqual(isSensitiveKey('appSecret'), true);
		});

		test('should identify authorization as sensitive', () => {
			assert.strictEqual(isSensitiveKey('authorization'), true);
			assert.strictEqual(isSensitiveKey('Authorization'), true);
		});

		test('should NOT flag non-sensitive keys', () => {
			assert.strictEqual(isSensitiveKey('name'), false);
			assert.strictEqual(isSensitiveKey('email'), false);
			assert.strictEqual(isSensitiveKey('username'), false);
			assert.strictEqual(isSensitiveKey('baseUrl'), false);
			assert.strictEqual(isSensitiveKey('model'), false);
		});
	});
});
