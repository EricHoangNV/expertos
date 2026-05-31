/**
 * Structured-log PII redaction (directive §4.10: never leak auth tokens, emails,
 * user identifiers, or billing metadata into logs/crash reporting).
 *
 * Defense in depth: log call sites should avoid putting PII in fields at all, but
 * this scrubs known-sensitive keys recursively as a backstop so an accidental
 * `logger.info("x", { email })` never ships raw PII.
 */

const REDACTED = "[redacted]";

/** Key names whose values are always replaced, matched case-insensitively as substrings. */
const SENSITIVE_KEY_PATTERNS = [
  "password",
  "token",
  "authorization",
  "secret",
  "apikey",
  "api_key",
  "cookie",
  "email",
  "phone",
  "creditcard",
  "card_number",
  "ssn",
];

function isSensitiveKey(key: string): boolean {
  const lower = key.toLowerCase();
  return SENSITIVE_KEY_PATTERNS.some((pattern) => lower.includes(pattern));
}

/**
 * Returns a deep copy of `value` with sensitive object keys replaced by
 * `"[redacted]"`. Non-plain values (strings, numbers, arrays of primitives) pass
 * through unchanged. Guards against cycles so a self-referential object can't loop.
 */
export function redact(value: unknown, seen: WeakSet<object> = new WeakSet()): unknown {
  if (value === null || typeof value !== "object") {
    return value;
  }
  if (seen.has(value)) {
    return "[circular]";
  }
  seen.add(value);

  if (Array.isArray(value)) {
    return value.map((item) => redact(item, seen));
  }

  const out: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    out[key] = isSensitiveKey(key) ? REDACTED : redact(val, seen);
  }
  return out;
}
