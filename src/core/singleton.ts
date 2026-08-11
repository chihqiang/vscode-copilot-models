/**
 * Generic singleton storage helper
 *
 * Eliminates the repetitive `private static instance` / `getInstance()` /
 * `resetInstance()` boilerplate shared by Logger, Tokenizer, ProviderModels
 * and TokenPlan.
 *
 * Two lifecycle policies:
 * - `lazyCreate` provided → `get()` lazily constructs on first access and
 *   never throws (used by Logger / Tokenizer).
 * - no `lazyCreate`       → `get()` throws until `set()` is called (strict
 *   "call init() first" policy used by ProviderModels / TokenPlan).
 */
export interface SingletonStore<T> {
  /** Get the instance, lazily creating it if `lazyCreate` was provided. */
  get(): T;
  /** Get the instance without throwing (undefined when not initialized). */
  getOptional(): T | undefined;
  /** Set the instance (used by `init()`-style strict singletons). */
  set(value: T): void;
  /** Clear the stored instance (used by `resetInstance()`). */
  reset(): void;
}

export function createSingletonStore<T>(options?: {
  lazyCreate?: () => T;
}): SingletonStore<T> {
  let instance: T | undefined;
  return {
    get(): T {
      if (instance === undefined) {
        if (!options?.lazyCreate) {
          throw new Error("Singleton not initialized. Call init() first.");
        }
        instance = options.lazyCreate();
      }
      return instance;
    },
    getOptional(): T | undefined {
      return instance;
    },
    set(value: T): void {
      instance = value;
    },
    reset(): void {
      instance = undefined;
    },
  };
}
