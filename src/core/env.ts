/**
 * 运行环境检测工具
 */

declare let process: { env: { NODE_ENV?: string } } | undefined;

function getNodeEnv(): string | undefined {
  if (typeof process !== 'undefined' && process.env) {
    return process.env.NODE_ENV;
  }
  return undefined;
}

export function isTestEnvironment(): boolean {
  return getNodeEnv() === 'test';
}

export function isDevelopmentEnvironment(): boolean {
  return getNodeEnv() === 'development';
}
