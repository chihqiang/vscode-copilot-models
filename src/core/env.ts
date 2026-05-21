/**
 * 运行环境检测工具
 */

export function isTestEnvironment(): boolean {
  return process.env.NODE_ENV === 'test';
}

export function isDevelopmentEnvironment(): boolean {
  return process.env.NODE_ENV === 'development';
}
