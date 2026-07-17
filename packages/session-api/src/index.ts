/**
 * Optional SaaS control plane (session provision + /attach).
 * Post-MVP (PR P2). Not required for CLI remote or browser public clone.
 */

export interface SessionAttachResult {
  /** Clean attach URL — no connection secrets in query */
  attachUrl: string;
  authority: string;
  expiresAt: string;
}

export async function createSession(): Promise<never> {
  throw new Error('@zcode/session-api: not implemented (post-MVP PR P2).');
}
