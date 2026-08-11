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

export function isSensitiveKey(key: string): boolean {
  return SENSITIVE_PATTERNS.some((pattern) => pattern.test(key));
}

// ── String-value redaction ───────────────────────────

/**
 * Patterns that match sensitive values embedded in a log string:
 * - OpenAI-style prefixed keys (sk-..., pk-..., ...)
 * - Bearer tokens in headers
 * - `key: value` / `key=value` forms (query strings, JSON, TS objects)
 */
const SENSITIVE_VALUE_PATTERNS: RegExp[] = [
  // Prefixed API keys: sk-abc..., pk-..., rk-..., tk-..., ak-...
  /\b(?:sk|pk|rk|tk|ak)-[A-Za-z0-9_-]{8,}/g,
  // Bearer tokens
  /\b(Bearer\s+)[A-Za-z0-9._~+/=-]{6,}/gi,
  // key: value / key = value / key=value / "key":"value" (sensitive key names only)
  /\b(api[_-]?key|access[_-]?token|auth[_-]?token|refresh[_-]?token|client[_-]?secret|secret|password|authorization|credential)\b(\s*["']?\s*[:=]\s*["']?)([^\s"',;&<>]+)/gi,
];

/**
 * Redact sensitive values embedded in a log string. Used as a final safety
 * net by the logger and for URL / error-body strings that bypass
 * sanitizeForLog (which only redacts object keys).
 */
export function redactSensitiveValues(text: string): string {
  let out = text;
  for (const pattern of SENSITIVE_VALUE_PATTERNS) {
    out = out.replace(
      pattern,
      (
        _match,
        keyOrPrefix: string,
        separator: string | undefined,
        value: string | undefined,
      ) => {
        if (value !== undefined && separator !== undefined) {
          // key=value form: keep the key and separator, redact the value.
          return `${keyOrPrefix}${separator}[REDACTED]`;
        }
        if (keyOrPrefix) {
          // prefix form (e.g. "Bearer "): keep the prefix, redact the rest.
          return `${keyOrPrefix}[REDACTED]`;
        }
        return "[REDACTED]";
      },
    );
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
