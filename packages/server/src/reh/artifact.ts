/**
 * Helpers for detecting a packaged REH artifact (R2c / R6).
 * Binaries under dist/server are never committed — only build markers.
 */
import fs from 'node:fs';
import path from 'node:path';
import { monorepoRoot, serverArtifactDir } from '../paths.js';

export interface RehArtifactInfo {
  dir: string;
  markerPath: string;
  binary: string | null;
  build?: Record<string, unknown>;
}

/** Prefer packaged entrypoints used by microsoft/vscode REH layouts. */
export function findRehBinary(dir: string): string | null {
  if (!fs.existsSync(dir)) return null;
  const candidates = [
    'bin/code-server-oss',
    'bin/code-server',
    'server.sh',
    'bin/remote-cli/code',
  ];
  for (const c of candidates) {
    const p = path.join(dir, c);
    if (fs.existsSync(p)) return p;
  }
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const e of entries) {
      if (e.isDirectory() && (e.name.startsWith('bin') || e.name.includes('server'))) {
        const hit = findRehBinary(path.join(dir, e.name));
        if (hit) return hit;
      }
      if (e.isFile() && /code-server/.test(e.name)) {
        return path.join(dir, e.name);
      }
    }
  } catch {
    /* ignore */
  }
  return null;
}

/**
 * Returns artifact info when `dist/server/.zcode-build.json` exists.
 * Binary may still be missing if the marker is a stub — callers should check `binary`.
 */
export function inspectRehArtifact(root = monorepoRoot()): RehArtifactInfo | null {
  const dir = serverArtifactDir(root);
  const markerPath = path.join(dir, '.zcode-build.json');
  if (!fs.existsSync(markerPath)) return null;
  let build: Record<string, unknown> | undefined;
  try {
    build = JSON.parse(fs.readFileSync(markerPath, 'utf8')) as Record<string, unknown>;
  } catch {
    build = undefined;
  }
  return {
    dir,
    markerPath,
    binary: findRehBinary(dir),
    build,
  };
}

/** True when a REH package marker exists (R2c success path). */
export function hasRehPackageMarker(root = monorepoRoot()): boolean {
  return inspectRehArtifact(root) !== null;
}

/** True when marker + runnable binary both exist (R6 runnable). */
export function hasRunnableRehArtifact(root = monorepoRoot()): boolean {
  const info = inspectRehArtifact(root);
  return Boolean(info?.binary);
}
