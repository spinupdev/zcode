/**
 * ZCode server wrapper: password login, HttpOnly session cookie, static co-serve,
 * optional REH spawn when artifacts/dev scripts exist.
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
export { spawnReh } from './reh/spawn.js';

export interface ServerOptions {
  host: string;
  port: number;
  workspace: string;
  password?: string;
  staticDir?: string;
  /** monorepo root for locating dist/server and vendor/vscode */
  repoRoot?: string;
  /** Internal REH listen port (default port+1) */
  rehPort?: number;
  /** Set false to skip REH spawn attempts */
  spawnReh?: boolean;
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

export function readServerBuildInfo(root = monorepoRoot()): ServerBuildInfo | null {
  const dir = serverArtifactDir(root);
  const marker = path.join(dir, '.zcode-build.json');
  if (!fs.existsSync(marker)) return null;
  const raw = JSON.parse(fs.readFileSync(marker, 'utf8')) as Omit<ServerBuildInfo, 'path'>;
  return { ...raw, path: dir };
}

export function hasRehArtifact(root = monorepoRoot()): boolean {
  return readServerBuildInfo(root) !== null;
}

export function hasVscodeVendor(root = monorepoRoot()): boolean {
  return fs.existsSync(path.join(vscodeVendorDir(root), 'package.json'));
}
