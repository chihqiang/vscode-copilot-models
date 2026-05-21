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
 *
 * 单次遍历替代多次正则匹配
 */
function fallbackCountTokens(text: string): number {
  let tokens = 0;
  let wordCount = 0;
  let digitLen = 0;
  let inWord = false;
  let inDigit = false;

  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);

    if ((code >= 0x41 && code <= 0x5a) || (code >= 0x61 && code <= 0x7a)) {
      if (!inWord) {
        inWord = true;
        wordCount++;
        if (inDigit) {
          tokens += digitLen * 0.25;
          digitLen = 0;
          inDigit = false;
        }
      }
    } else {
      if (inWord) { inWord = false; }

      if (code >= 0x30 && code <= 0x39) {
        inDigit = true;
        digitLen++;
      } else {
        if (inDigit) {
          tokens += digitLen * 0.25;
          digitLen = 0;
          inDigit = false;
        }

        if (
          (code >= 0x4e00 && code <= 0x9fff) ||
          (code >= 0x3040 && code <= 0x30ff) ||
          (code >= 0x3400 && code <= 0x4dbf) ||
          (code >= 0xf900 && code <= 0xfaff)
        ) {
          tokens += 2;
        } else {
          tokens += 0.25;
        }
      }
    }
  }

  if (inDigit) { tokens += digitLen * 0.25; }
  tokens += wordCount * 1.3;

  return Math.max(1, Math.ceil(tokens + 1));
}
