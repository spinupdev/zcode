/**
 * Structured log / diagnostics secret redaction (M2, KD12).
 */

const SECRET_KEYS = [
  'connectiontoken',
  'connection_token',
  'tkn',
  'token',
  'password',
  'authorization',
  'connectcode',
  'connect_code',
  'cc',
  'cookie',
  'set-cookie',
  'zcode_sess',
  'pat',
  'github_token',
  'gitlab_token',
];

const SECRET_PATTERNS: RegExp[] = [
  /connectionToken=[^&\s"']+/gi,
  /[?&]tkn=[^&\s"']+/gi,
  /Bearer\s+[A-Za-z0-9._\-]+/gi,
  /zcode_sess=[^;\s"']+/gi,
  /password["']?\s*[:=]\s*["']?[^"'\s,]+/gi,
];

function isSecretKey(key: string): boolean {
  const k = key.toLowerCase().replace(/[^a-z0-9_]/g, '');
  return SECRET_KEYS.some((s) => k === s || k.includes(s));
}

/** Redact known secret substrings from a free-form string. */
export function redactString(input: string): string {
  let out = input;
  for (const re of SECRET_PATTERNS) {
    out = out.replace(re, (m) => {
      if (m.toLowerCase().startsWith('bearer')) return 'Bearer [REDACTED]';
      if (m.includes('=')) return `${m.split('=')[0]}=[REDACTED]`;
      return '[REDACTED]';
    });
  }
  return out;
}

/**
 * Deep-clone JSON-like values with secret keys replaced by `[REDACTED]`.
 * Strings are also pattern-scrubbed.
 */
export function redactSecrets<T>(value: T, depth = 0): T {
  if (depth > 12) return value;
  if (value == null) return value;
  if (typeof value === 'string') return redactString(value) as T;
  if (typeof value !== 'object') return value;
  if (Array.isArray(value)) {
    return value.map((v) => redactSecrets(v, depth + 1)) as T;
  }
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (isSecretKey(k)) {
      out[k] = '[REDACTED]';
    } else {
      out[k] = redactSecrets(v, depth + 1);
    }
  }
  return out as T;
}

/** Safe JSON.stringify for logs */
export function safeJsonStringify(value: unknown, space?: number): string {
  return redactString(JSON.stringify(redactSecrets(value), null, space));
}
