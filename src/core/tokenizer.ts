/**
 * Token 计数器
 *
 * 使用 o200k_base 编码（GPT-4o 同款）精确计算 token 数，
 * 失败时降级为启发式估算。
 *
 * 资源管理：提供 freeTokenizer() 供扩展停用时释放内存。
 */

import { get_encoding, Tiktoken } from '@dqbd/tiktoken';

let encoder: Tiktoken | null = null;

/** 获取或创建 tiktoken 编码器（惰性初始化） */
function getEncoder(): Tiktoken {
  if (!encoder) {
    encoder = get_encoding('o200k_base');
  }
  return encoder;
}

/** 计算文本的 token 数（精确计算，失败时降级） */
export function countTokens(text: string): number {
  try {
    return getEncoder().encode_ordinary(text).length;
  } catch {
    return fallbackCountTokens(text);
  }
}

/** 释放 tiktoken 编码器（扩展停用时调用） */
export function freeTokenizer(): void {
  if (encoder) {
    try {
      encoder.free();
    } catch {
      // ignore
    }
    encoder = null;
  }
}

/**
 * 启发式 token 估算（降级方案）
 * - 英文单词: 1.3 token/词
 * - CJK 字符: 2 token/字
 * - 数字: 0.25 token/字符
 * - 其他: 0.25 token/字符
 */
function fallbackCountTokens(text: string): number {
  let tokens = 0;

  const words = text.match(/[a-zA-Z]+/g);
  if (words) {
    tokens += words.length * 1.3;
  }

  const cjk = text.match(/[\u4e00-\u9fff\u3040-\u30ff\u3400-\u4dbf\uf900-\ufaff]/g);
  if (cjk) {
    tokens += cjk.length * 2;
  }

  const digits = text.match(/[0-9]+/g);
  if (digits) {
    tokens += digits.reduce((s, n) => s + n.length * 0.25, 0);
  }

  const remaining = text.replace(/[a-zA-Z\u4e00-\u9fff\u3040-\u30ff\u3400-\u4dbf\uf900-\ufaff0-9]/g, '');
  tokens += remaining.length * 0.25;

  return Math.max(1, Math.ceil(tokens + 1));
}
