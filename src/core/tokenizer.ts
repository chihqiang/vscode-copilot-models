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
import { createSingletonStore } from "./singleton";

export class Tokenizer implements vscode.Disposable {
  private static store = createSingletonStore<Tokenizer>({
    lazyCreate: () => new Tokenizer(),
  });

  /**
   * Upper bound on retained text, not on entry count alone.
   *
   * VS Code asks for a token count per message, and a long conversation sends
   * the same historical messages on every turn. Without memoisation each turn
   * re-encodes the entire history through WASM. Entries are bounded by total
   * retained characters as well as by count, so a session full of large
   * messages cannot pin unbounded memory.
   */
  private static readonly CACHE_MAX_CHARS = 1_000_000;
  private static readonly CACHE_MAX_ENTRIES = 512;

  private encoder: Tiktoken | null = null;
  private readonly countCache = new Map<string, number>();
  private cachedChars = 0;

  private constructor() {}

  static getInstance(): Tokenizer {
    return Tokenizer.store.get();
  }

  static resetInstance(): void {
    const inst = Tokenizer.store.getOptional();
    inst?.dispose();
    Tokenizer.store.reset();
  }

  /** Count tokens in text (accurate, falls back on failure) */
  countTokens(text: string): number {
    const cached = this.countCache.get(text);
    if (cached !== undefined) {
      return cached;
    }

    let count: number;
    try {
      count = this.getEncoder().encode_ordinary(text).length;
    } catch {
      count = this.fallbackCountTokens(text);
    }

    this.remember(text, count);
    return count;
  }

  /** Release WASM resources */
  dispose(): void {
    this.countCache.clear();
    this.cachedChars = 0;
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

  /**
   * Cache a count, evicting oldest entries (insertion order) until both the
   * character budget and the entry cap are satisfied.
   */
  private remember(text: string, count: number): void {
    // Empty text is trivially counted, and a text larger than the whole budget
    // would be evicted immediately — retaining it costs memory for nothing.
    if (text.length === 0 || text.length > Tokenizer.CACHE_MAX_CHARS) {
      return;
    }

    this.countCache.set(text, count);
    this.cachedChars += text.length;

    while (
      this.cachedChars > Tokenizer.CACHE_MAX_CHARS ||
      this.countCache.size > Tokenizer.CACHE_MAX_ENTRIES
    ) {
      const oldest = this.countCache.keys().next();
      if (oldest.done) {
        break;
      }
      this.countCache.delete(oldest.value);
      this.cachedChars -= oldest.value.length;
    }
  }

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

    // English words: 1.3 tokens/word
    const words = text.match(/[A-Za-z]+/g);
    if (words) {
      tokens += words.length * 1.3;
    }

    // CJK characters: 2 tokens/char
    const cjk = text.match(
      /[\u3400-\u4dbf\u4e00-\u9fff\u3040-\u30ff\uf900-\ufaff]/g,
    );
    if (cjk) {
      tokens += cjk.length * 2;
    }

    // Digits: 0.25 tokens/char
    const digits = text.match(/[0-9]+/g);
    if (digits) {
      for (const d of digits) {
        tokens += d.length * 0.25;
      }
    }

    // Everything else (spaces, punctuation, etc.): 0.25 tokens/char
    const other = text.replace(
      /[A-Za-z\u3400-\u4dbf\u4e00-\u9fff\u3040-\u30ff\uf900-\ufaff0-9]/g,
      "",
    );
    tokens += other.length * 0.25;

    return Math.max(1, Math.ceil(tokens + 1));
  }
}
