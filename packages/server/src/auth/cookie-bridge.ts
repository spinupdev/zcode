import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export const SESSION_COOKIE = 'zcode_sess';

export interface SessionRecord {
  id: string;
  /** Internal VS Code --connection-token value (never returned to browser JS) */
  connectionToken: string;
  createdAt: number;
  expiresAt: number;
}

/**
 * Maps HttpOnly session cookies to the internal VS Code connection-token.
 * The workbench never receives the token string (KD12).
 */
export class CookieTokenBridge {
  private readonly sessions = new Map<string, SessionRecord>();

  constructor(
    private readonly signingSecret: string,
    private readonly ttlMs = 12 * 60 * 60 * 1000,
  ) {}

  /** Create a session after successful password login. */
  createSession(connectionToken = randomBytes(24).toString('base64url')): {
    sessionId: string;
    cookieValue: string;
    connectionToken: string;
    expiresAt: number;
  } {
    const sessionId = randomBytes(18).toString('base64url');
    const expiresAt = Date.now() + this.ttlMs;
    this.sessions.set(sessionId, {
      id: sessionId,
      connectionToken,
      createdAt: Date.now(),
      expiresAt,
    });
    const cookieValue = signValue(sessionId, this.signingSecret);
    return { sessionId, cookieValue, connectionToken, expiresAt };
  }

  /** Resolve cookie header value → internal connection token. */
  resolveConnectionToken(cookieHeader: string | undefined): string | null {
    const raw = parseCookie(cookieHeader)[SESSION_COOKIE];
    if (!raw) return null;
    const sessionId = verifyValue(raw, this.signingSecret);
    if (!sessionId) return null;
    const rec = this.sessions.get(sessionId);
    if (!rec) return null;
    if (rec.expiresAt < Date.now()) {
      this.sessions.delete(sessionId);
      return null;
    }
    return rec.connectionToken;
  }

  isAuthenticated(cookieHeader: string | undefined): boolean {
    return this.resolveConnectionToken(cookieHeader) !== null;
  }

  revokeFromCookie(cookieHeader: string | undefined): void {
    const raw = parseCookie(cookieHeader)[SESSION_COOKIE];
    if (!raw) return;
    const sessionId = verifyValue(raw, this.signingSecret);
    if (sessionId) this.sessions.delete(sessionId);
  }

  /** Set-Cookie attributes for same-origin MVP (Secure when https). */
  buildSetCookie(cookieValue: string, opts: { secure?: boolean; maxAgeSec?: number } = {}): string {
    const parts = [
      `${SESSION_COOKIE}=${cookieValue}`,
      'Path=/',
      'HttpOnly',
      'SameSite=Lax',
    ];
    if (opts.secure) parts.push('Secure');
    if (opts.maxAgeSec != null) parts.push(`Max-Age=${opts.maxAgeSec}`);
    return parts.join('; ');
  }

  clearCookie(opts: { secure?: boolean } = {}): string {
    const parts = [`${SESSION_COOKIE}=`, 'Path=/', 'HttpOnly', 'SameSite=Lax', 'Max-Age=0'];
    if (opts.secure) parts.push('Secure');
    return parts.join('; ');
  }
}

export function parseCookie(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    if (k) out[k] = v;
  }
  return out;
}

function signValue(value: string, secret: string): string {
  const sig = createHmac('sha256', secret).update(value).digest('base64url');
  return `${value}.${sig}`;
}

function verifyValue(signed: string, secret: string): string | null {
  const i = signed.lastIndexOf('.');
  if (i <= 0) return null;
  const value = signed.slice(0, i);
  const sig = signed.slice(i + 1);
  const expected = createHmac('sha256', secret).update(value).digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  return value;
}
