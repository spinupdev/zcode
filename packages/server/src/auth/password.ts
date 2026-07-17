import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

export interface PasswordVerifier {
  verify(password: string): boolean;
}

/** scrypt hash format: scrypt$N$r$p$saltB64$hashB64 */
export function hashPassword(password: string): string {
  const N = 16384;
  const r = 8;
  const p = 1;
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 32, { N, r, p });
  return `scrypt$${N}$${r}$${p}$${salt.toString('base64url')}$${hash.toString('base64url')}`;
}

export function verifyPassword(password: string, encoded: string): boolean {
  const parts = encoded.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') {
    return false;
  }
  const N = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  const salt = Buffer.from(parts[4]!, 'base64url');
  const expected = Buffer.from(parts[5]!, 'base64url');
  const actual = scryptSync(password, salt, expected.length, { N, r, p });
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}

export function createPasswordVerifier(passwordOrHash: string): PasswordVerifier {
  const encoded = passwordOrHash.startsWith('scrypt$')
    ? passwordOrHash
    : hashPassword(passwordOrHash);
  return {
    verify(password: string): boolean {
      return verifyPassword(password, encoded);
    },
  };
}

export class LoginRateLimiter {
  private readonly failures = new Map<string, { count: number; lockedUntil: number }>();

  constructor(
    private readonly maxAttempts = 5,
    private readonly lockoutMs = 60_000,
  ) {}

  assertAllowed(key: string): void {
    const row = this.failures.get(key);
    if (!row) return;
    if (row.lockedUntil > Date.now()) {
      const wait = Math.ceil((row.lockedUntil - Date.now()) / 1000);
      throw Object.assign(new Error(`too many attempts; retry in ${wait}s`), {
        code: 'RATE_LIMIT',
        status: 429,
      });
    }
  }

  recordFailure(key: string): void {
    const row = this.failures.get(key) ?? { count: 0, lockedUntil: 0 };
    row.count += 1;
    if (row.count >= this.maxAttempts) {
      row.lockedUntil = Date.now() + this.lockoutMs;
      row.count = 0;
    }
    this.failures.set(key, row);
  }

  recordSuccess(key: string): void {
    this.failures.delete(key);
  }
}

/** Stable fingerprint for logs (never log raw password) */
export function passwordFingerprint(password: string): string {
  return createHash('sha256').update(password).digest('hex').slice(0, 12);
}
