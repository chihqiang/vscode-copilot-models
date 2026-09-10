/**
 * Log sanitization utilities — redact sensitive data from log output
 */

// ── Object-key redaction ─────────────────────────────

/** Patterns that match sensitive key names (compiled once) */
const SENSITIVE_PATTERNS: RegExp[] = [
  /api[_\-]?key/i,
  /authorization/i,
  /bearer/i,
  /password/i,
  /token/i,
  /secret/i,
  /credential/i,
  /auth/i,
  /cookie/i,
  /session/i,
];

export function sanitizeForLog(obj: unknown): unknown {
  if (typeof obj !== "object" || obj === null) {
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map(sanitizeForLog);
  }

  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (isSensitiveKey(key)) {
      result[key] = "[REDACTED]";
    } else if (typeof value === "object" && value !== null) {
      result[key] = sanitizeForLog(value);
    } else {
      result[key] = value;
    }
  }
  return result;
}

/**
 * Keys that contain "token" but hold a count or limit, not a secret.
 *
 * The `/token/i` pattern below is deliberately broad so unknown keys fail safe
 * (they get redacted). These exact names are known-safe numbers, and redacting
 * them defeated the debug logging of a token-usage feature: the request body
 * logged `max_tokens` as `[REDACTED]` and every usage total vanished.
 *
 * Compared after lowercasing and stripping non-alphanumerics, so `max_tokens`,
 * `maxTokens` and `max-tokens` all resolve to a single entry. Anything not
 * listed here keeps the broad-pattern behaviour.
 */
const SAFE_TOKEN_COUNT_KEYS = new Set([
  "maxtokens",
  "prompttokens",
  "completiontokens",
  "totaltokens",
  "inputtokens",
  "outputtokens",
  "reasoningtokens",
  "cachedtokens",
  "maxinputtokens",
  "maxoutputtokens",
  "tokencount",
]);

function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function isSensitiveKey(key: string): boolean {
  if (SAFE_TOKEN_COUNT_KEYS.has(normalizeKey(key))) {
    return false;
  }
  return SENSITIVE_PATTERNS.some((pattern) => pattern.test(key));
}

// ── String-value redaction ───────────────────────────

/**
 * A redaction rule: what to match, and what to leave in its place.
 *
 * The replacement is a string rather than a callback on purpose. These
 * patterns have different numbers of capture groups, and a shared callback
 * receives arguments positionally — `(match, p1, p2, p3, offset, input)`. With
 * patterns of mixed arity the same callback reads `offset` as `p1`, which
 * injected the match offset into the log text (`Bearer 0[REDACTED]`, and
 * `using 6[REDACTED]` for a prefixed key). A per-rule replacement string
 * cannot be misread, and keeps the prefix each rule needs to preserve.
 */
interface RedactionRule {
  pattern: RegExp;
  /** `$1`/`$2` refer to this rule's own capture groups. */
  replacement: string;
}

/**
 * Patterns that match sensitive values embedded in a log string:
 * - OpenAI-style prefixed keys (sk-..., pk-..., ...)
 * - Bearer tokens in headers
 * - `key: value` / `key=value` forms (query strings, JSON, TS objects)
 */
const SENSITIVE_VALUE_RULES: readonly RedactionRule[] = [
  // Prefixed API keys: sk-abc..., pk-..., rk-..., tk-..., ak-...
  // The whole token is the secret, so nothing is preserved.
  {
    pattern: /\b(?:sk|pk|rk|tk|ak)-[A-Za-z0-9_-]{8,}/g,
    replacement: "[REDACTED]",
  },
  // Bearer tokens: keep the scheme so the log still reads as a header.
  {
    pattern: /\b(Bearer\s+)[A-Za-z0-9._~+/=-]{6,}/gi,
    replacement: "$1[REDACTED]",
  },
  // key: value / key = value / key=value / "key":"value" (sensitive key names only).
  // Keeps the key and separator so the entry remains identifiable.
  {
    pattern:
      /\b(api[_-]?key|access[_-]?token|auth[_-]?token|refresh[_-]?token|client[_-]?secret|secret|password|authorization|credential)\b(\s*["']?\s*[:=]\s*["']?)([^\s"',;&<>]+)/gi,
    replacement: "$1$2[REDACTED]",
  },
];

/**
 * Redact sensitive values embedded in a log string. Used as a final safety
 * net by the logger and for URL / error-body strings that bypass
 * sanitizeForLog (which only redacts object keys).
 */
export function redactSensitiveValues(text: string): string {
  let out = text;
  for (const { pattern, replacement } of SENSITIVE_VALUE_RULES) {
    // A fresh `lastIndex` per call: the regexes are module-level and carry the
    // `g` flag, so a shared one would resume mid-string depending on how the
    // previous call left it.
    pattern.lastIndex = 0;
    out = out.replace(pattern, replacement);
  }
  return out;
}

// ── URL redaction ────────────────────────────────────

/**
 * Strip the query string and fragment from a URL before logging.
 * Users sometimes embed API keys in URLs (e.g. `https://host/v1?key=xxx`),
 * so the query is removed rather than redacted in place.
 */
export function sanitizeUrl(url: string): string {
  try {
    const u = new URL(url);
    u.search = "";
    u.hash = "";
    return u.toString();
  } catch {
    // Not a valid URL — fall back to value-level redaction.
    return redactSensitiveValues(url);
  }
}
