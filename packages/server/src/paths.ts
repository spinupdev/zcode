import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Monorepo root (…/packages/server/src -> ../../..) */
export function monorepoRoot(from = fileURLToPath(import.meta.url)): string {
  // dist/paths.js -> packages/server/dist -> packages/server -> packages -> root
  return path.resolve(path.dirname(from), '../../..');
}

export function serverArtifactDir(root = monorepoRoot()): string {
  return path.join(root, 'dist', 'server');
}

export function webArtifactDir(root = monorepoRoot()): string {
  return path.join(root, 'dist', 'web');
}

export function vscodeVendorDir(root = monorepoRoot()): string {
  return path.join(root, 'vendor', 'vscode');
}
