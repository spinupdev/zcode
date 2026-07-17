/**
 * Node wrapper around VS Code server / REH: cookie↔token bridge, static co-serve.
 *
 * R2: REH artifacts via scripts/build-server.sh → dist/server
 * R3: password login + HttpOnly session cookie mapping (this package)
 * Later: spawn REH with --connection-token and co-serve workbench assets
 */

import fs from 'node:fs';
import path from 'node:path';
import { monorepoRoot, serverArtifactDir, vscodeVendorDir } from './paths.js';

export { monorepoRoot, serverArtifactDir, webArtifactDir, vscodeVendorDir } from './paths.js';
export { CookieTokenBridge, SESSION_COOKIE } from './auth/cookie-bridge.js';
export {
  hashPassword,
  verifyPassword,
  createPasswordVerifier,
  LoginRateLimiter,
} from './auth/password.js';
export { startServer } from './http/start.js';
export type { StartedServer } from './http/start.js';

export interface ServerOptions {
  host: string;
  port: number;
  /** Workspace root on disk */
  workspace: string;
  /** Password auth for self-host MVP (plaintext only for bootstrap; prefer hash env later) */
  password?: string;
  /** Directory of co-served workbench static assets (same-origin MVP) */
  staticDir?: string;
}

export interface ServerBuildInfo {
  kind: string;
  task?: string;
  vscodeCommit?: string;
  platform?: string;
  arch?: string;
  builtAt?: string;
  path: string;
}

/** Read marker written by scripts/build-server.sh after REH package. */
export function readServerBuildInfo(root = monorepoRoot()): ServerBuildInfo | null {
  const dir = serverArtifactDir(root);
  const marker = path.join(dir, '.zcode-build.json');
  if (!fs.existsSync(marker)) {
    return null;
  }
  const raw = JSON.parse(fs.readFileSync(marker, 'utf8')) as Omit<ServerBuildInfo, 'path'>;
  return { ...raw, path: dir };
}

export function hasRehArtifact(root = monorepoRoot()): boolean {
  return readServerBuildInfo(root) !== null;
}

export function hasVscodeVendor(root = monorepoRoot()): boolean {
  return fs.existsSync(path.join(vscodeVendorDir(root), 'package.json'));
}
