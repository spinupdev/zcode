/**
 * Auth helpers: password self-host (MVP), OIDC / connect codes (SaaS).
 * Never return long-lived connection tokens from list/GET APIs.
 *
 * Runtime password verify + cookie bridge live in @zcode/server (R3).
 */

export interface PasswordAuthConfig {
  /** Scrypt/argon2 hash — never store plaintext */
  passwordHash: string;
  maxAttempts: number;
  lockoutMs: number;
}

/** One-time redeemable attach code (body/sessionStorage/fragment — not production query). */
export interface ConnectCode {
  code: string;
  sessionId: string;
  expiresAt: Date;
}

export function assertNoSecretInUrl(url: string): void {
  const u = new URL(url, 'http://localhost');
  for (const key of ['tkn', 'token', 'connectionToken', 'cc', 'connectCode']) {
    if (u.searchParams.has(key)) {
      throw new Error(`URL must not contain secret query param "${key}"`);
    }
  }
}

/** Alias used by shell/product docs */
export const assertCleanIdeUrl = assertNoSecretInUrl;
