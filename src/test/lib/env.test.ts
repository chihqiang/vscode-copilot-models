import * as assert from 'assert';
import { isTestEnvironment, isDevelopmentEnvironment } from '../../core/lib/logger';

suite('env Test Suite', () => {
  const ORIGINAL_NODE_ENV = process.env.NODE_ENV;

  teardown(() => {
    process.env.NODE_ENV = ORIGINAL_NODE_ENV;
  });

  test('isTestEnvironment returns false by default', () => {
    delete process.env.NODE_ENV;
    assert.strictEqual(isTestEnvironment(), false);
  });

  test('isTestEnvironment returns true when NODE_ENV=test', () => {
    process.env.NODE_ENV = 'test';
    assert.strictEqual(isTestEnvironment(), true);
  });

  test('isDevelopmentEnvironment returns false by default', () => {
    delete process.env.NODE_ENV;
    assert.strictEqual(isDevelopmentEnvironment(), false);
  });

  test('isDevelopmentEnvironment returns true when NODE_ENV=development', () => {
    process.env.NODE_ENV = 'development';
    assert.strictEqual(isDevelopmentEnvironment(), true);
  });

  test('isTestEnvironment and isDevelopmentEnvironment are mutually exclusive', () => {
    process.env.NODE_ENV = 'test';
    assert.strictEqual(isTestEnvironment(), true);
    assert.strictEqual(isDevelopmentEnvironment(), false);

    process.env.NODE_ENV = 'development';
    assert.strictEqual(isTestEnvironment(), false);
    assert.strictEqual(isDevelopmentEnvironment(), true);
  });

  test('unrecognized NODE_ENV returns false for both', () => {
    process.env.NODE_ENV = 'staging';
    assert.strictEqual(isTestEnvironment(), false);
    assert.strictEqual(isDevelopmentEnvironment(), false);
  });
});
