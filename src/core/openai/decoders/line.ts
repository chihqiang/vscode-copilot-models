/**
 * 行解码器
 *
 * 处理 HTTP 分块传输中的行分割，支持：
 * - \n（LF）和 \r\n（CRLF）行尾
 * - 孤立的 \r（CR）行尾
 * - 跨 chunk 边界的行拼接
 * - UTF-8 文本解码
 *
 * 从 OpenAI SDK v6.38.0 移植
 */

import { concatBytes, decodeUTF8, encodeUTF8 } from '../utils/bytes';

export type Bytes = string | ArrayBuffer | Uint8Array | null | undefined;

/**
 * 按行解码器
 * 维护跨 chunk 的内部缓冲区，正确处理 \r 和 \r\n 混合场景
 */
export class LineDecoder {
  static NEWLINE_CHARS = new Set(['\n', '\r']);
  static NEWLINE_REGEXP = /\r\n|[\n\r]/g;

  /** 内部缓冲区，保存尚未组成完整行的字节 */
  #buffer: Uint8Array;
  /** 上一个 chunk 尾部是否有孤立的 \r */
  #carriageReturnIndex: number | null;

  constructor() {
    this.#buffer = new Uint8Array();
    this.#carriageReturnIndex = null;
  }

  /** 解码一批字节，返回完整的行 */
  decode(chunk: Bytes): string[] {
    if (chunk === null || chunk === undefined) {
      return [];
    }

    const binaryChunk =
      chunk instanceof ArrayBuffer ? new Uint8Array(chunk)
      : typeof chunk === 'string' ? encodeUTF8(chunk)
      : chunk;

    this.#buffer = concatBytes([this.#buffer, binaryChunk]);

    const lines: string[] = [];
    let patternIndex;
    while ((patternIndex = findNewlineIndex(this.#buffer, this.#carriageReturnIndex)) !== null) {
      if (patternIndex.carriage && this.#carriageReturnIndex === null) {
        this.#carriageReturnIndex = patternIndex.index;
        continue;
      }

      if (
        this.#carriageReturnIndex !== null &&
        (patternIndex.index !== this.#carriageReturnIndex + 1 || patternIndex.carriage)
      ) {
        lines.push(decodeUTF8(this.#buffer.subarray(0, this.#carriageReturnIndex - 1)));
        this.#buffer = this.#buffer.subarray(this.#carriageReturnIndex);
        this.#carriageReturnIndex = null;
        continue;
      }

      const endIndex =
        this.#carriageReturnIndex !== null ? patternIndex.preceding - 1 : patternIndex.preceding;

      const line = decodeUTF8(this.#buffer.subarray(0, endIndex));
      lines.push(line);

      this.#buffer = this.#buffer.subarray(patternIndex.index);
      this.#carriageReturnIndex = null;
    }

    return lines;
  }

  /** 刷新剩余缓冲区中的内容 */
  flush(): string[] {
    if (!this.#buffer.length) {
      return [];
    }
    return this.decode('\n');
  }
}

/** 在缓冲区中查找下一个换行符位置 */
function findNewlineIndex(
  buffer: Uint8Array,
  startIndex: number | null,
): { preceding: number; index: number; carriage: boolean } | null {
  const newline = 0x0a;
  const carriage = 0x0d;

  for (let i = startIndex ?? 0; i < buffer.length; i++) {
    if (buffer[i] === newline) {
      return { preceding: i, index: i + 1, carriage: false };
    }

    if (buffer[i] === carriage) {
      return { preceding: i, index: i + 1, carriage: true };
    }
  }

  return null;
}

/** 查找双换行符位置（\n\n、\r\r 或 \r\n\r\n），用于 SSE chunk 边界检测 */
export function findDoubleNewlineIndex(buffer: Uint8Array): number {
  const newline = 0x0a;
  const carriage = 0x0d;

  for (let i = 0; i < buffer.length - 1; i++) {
    if (buffer[i] === newline && buffer[i + 1] === newline) {
      return i + 2;
    }
    if (buffer[i] === carriage && buffer[i + 1] === carriage) {
      return i + 2;
    }
    if (
      buffer[i] === carriage &&
      buffer[i + 1] === newline &&
      i + 3 < buffer.length &&
      buffer[i + 2] === carriage &&
      buffer[i + 3] === newline
    ) {
      return i + 4;
    }
  }

  return -1;
}
