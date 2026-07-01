/**
 * Line decoder for streaming byte data
 * Handles various newline formats (\n, \r\n, \r)
 */

import { concatBytes, encodeUTF8, decodeUTF8 } from "./bytes";

export type Bytes = string | ArrayBuffer | Uint8Array | null | undefined;

export class LineDecoder {
  static NEWLINE_CHARS = new Set(["\n", "\r"]);
  static NEWLINE_REGEXP = /\r\n|[\n\r]/g;

  #buffer: Uint8Array;
  #carriageReturnIndex: number | null;

  constructor() {
    this.#buffer = new Uint8Array();
    this.#carriageReturnIndex = null;
  }

  decode(chunk: Bytes): string[] {
    if (chunk === null || chunk === undefined) {
      return [];
    }

    const binaryChunk =
      chunk instanceof ArrayBuffer
        ? new Uint8Array(chunk)
        : typeof chunk === "string"
          ? encodeUTF8(chunk)
          : chunk;

    this.#buffer = concatBytes([this.#buffer, binaryChunk]);

    const lines: string[] = [];
    let patternIndex;
    while (
      (patternIndex = findNewlineIndex(
        this.#buffer,
        this.#carriageReturnIndex,
      )) !== null
    ) {
      if (patternIndex.carriage && this.#carriageReturnIndex === null) {
        this.#carriageReturnIndex = patternIndex.index;
        continue;
      }

      if (
        this.#carriageReturnIndex !== null &&
        (patternIndex.index !== this.#carriageReturnIndex + 1 ||
          patternIndex.carriage)
      ) {
        lines.push(
          decodeUTF8(this.#buffer.subarray(0, this.#carriageReturnIndex - 1)),
        );
        this.#buffer = this.#buffer.subarray(this.#carriageReturnIndex);
        this.#carriageReturnIndex = null;
        continue;
      }

      const endIndex =
        this.#carriageReturnIndex !== null
          ? patternIndex.preceding - 1
          : patternIndex.preceding;

      const line = decodeUTF8(this.#buffer.subarray(0, endIndex));
      lines.push(line);

      this.#buffer = this.#buffer.subarray(patternIndex.index);
      this.#carriageReturnIndex = null;
    }

    return lines;
  }

  flush(): string[] {
    if (!this.#buffer.length) {
      return [];
    }
    return this.decode("\n");
  }
}

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
