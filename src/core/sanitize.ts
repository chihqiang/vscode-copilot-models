/**
 * Log sanitization utilities - redact sensitive data from log output
 */

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
  const sensitivePatterns: RegExp[] = [
    /api[_\-]?key/i,
    /authorization/i,
    /bearer/i,
    /password/i,
    /token/i,
    /secret/i,
  ];
  return sensitivePatterns.some((pattern) => pattern.test(key));
}
