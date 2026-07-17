/**
 * Node wrapper around VS Code server / REH: cookie↔token bridge, static co-serve.
 * Full implementation: PR R3+.
 *
 * REH artifacts are produced by scripts/build-server.sh into dist/server (R2).
 */

import fs from 'node:fs';
import path from 'node:path';
import { monorepoRoot, serverArtifactDir, vscodeVendorDir } from './paths.js';

export { monorepoRoot, serverArtifactDir, webArtifactDir, vscodeVendorDir } from './paths.js';

export interface ServerOptions {
  host: string;
  port: number;
  /** Workspace root on disk */
  workspace: string;
  /** Password auth for self-host MVP */
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

export async function startServer(_options: ServerOptions): Promise<never> {
  if (!hasRehArtifact() && !hasVscodeVendor()) {
    throw new Error(
      '@zcode/server: no REH artifact and no vendor/vscode — run scripts/add-vscode-submodule.sh and scripts/build-server.sh',
    );
  }
  throw new Error(
    '@zcode/server: startServer not implemented yet (cookie bridge + co-serve is PR R3). Build with scripts/build-server.sh first.',
  );
}
