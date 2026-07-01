/**
 * Tokenizer — OOP singleton for token counting
 *
 * Uses o200k_base encoding (same as GPT-4o) to accurately count tokens,
 * falls back to heuristic estimation on failure.
 *
 * Resource management: implements vscode.Disposable for cleanup on deactivation.
 */

import vscode from "vscode";
import { get_encoding, Tiktoken } from "@dqbd/tiktoken";

export class Tokenizer implements vscode.Disposable {
  private static instance: Tokenizer | undefined;
  private encoder: Tiktoken | null = null;

  private constructor() {}

  static getInstance(): Tokenizer {
    if (!Tokenizer.instance) {
      Tokenizer.instance = new Tokenizer();
    }
    return Tokenizer.instance;
  }

  static resetInstance(): void {
    Tokenizer.instance?.dispose();
    Tokenizer.instance = undefined;
  }

  /** Count tokens in text (accurate, falls back on failure) */
  countTokens(text: string): number {
    try {
      return this.getEncoder().encode_ordinary(text).length;
    } catch {
      return this.fallbackCountTokens(text);
    }
  }

  /** Release WASM resources */
  dispose(): void {
    if (this.encoder) {
      try {
        this.encoder.free();
      } catch {
        // ignore
      }
      this.encoder = null;
    }
  }

  // ── Private ──────────────────────────────────────

  private getEncoder(): Tiktoken {
    if (!this.encoder) {
      this.encoder = get_encoding("o200k_base");
    }
    return this.encoder;
  }

  /**
   * Heuristic token estimation (fallback)
   * - English words: 1.3 tokens/word
   * - CJK characters: 2 tokens/char
   * - Digits: 0.25 tokens/char
   * - Other: 0.25 tokens/char
   */
  private fallbackCountTokens(text: string): number {
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
        if (inWord) {
          inWord = false;
        }

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

    if (inDigit) {
      tokens += digitLen * 0.25;
    }
    tokens += wordCount * 1.3;

    return Math.max(1, Math.ceil(tokens + 1));
  }
}
