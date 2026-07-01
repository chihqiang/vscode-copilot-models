/**
 * Provider module exports
 */

export * from "./deepseek";
export * from "./bigmodel";
export * from "./qwen";

import type { IProviderFactory } from "../core";
import { registerDeepSeekProviderFactory } from "./deepseek";
import { registerBigModelProviderFactory } from "./bigmodel";
import { registerQwenProviderFactory } from "./qwen";

let builtInFactories: IProviderFactory[] | null = null;

export function getBuiltInProviderFactories(): IProviderFactory[] {
  if (!builtInFactories) {
    builtInFactories = [
      registerDeepSeekProviderFactory(),
      registerBigModelProviderFactory(),
      registerQwenProviderFactory(),
    ];
  }
  return builtInFactories;
}
