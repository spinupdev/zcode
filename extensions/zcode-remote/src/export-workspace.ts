/**
 * Collect browser workspace files via vscode.workspace.fs for WS1 import.
 */
import * as vscode from 'vscode';

export type FilesV1Payload = {
  format: 'files-v1';
  workspaceId?: string;
  files: Record<string, { encoding: 'utf8' | 'base64'; data: string }>;
};

const SKIP_NAMES = new Set(['.git', 'node_modules', '.DS_Store']);
const MAX_FILES = 2000;
const MAX_BYTES = 20 * 1024 * 1024;

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function isMostlyText(bytes: Uint8Array): boolean {
  const n = Math.min(bytes.length, 512);
  for (let i = 0; i < n; i++) {
    const c = bytes[i]!;
    if (c === 0) return false;
    if (c < 9 || (c > 13 && c < 32)) return false;
  }
  return true;
}

async function walk(
  dir: vscode.Uri,
  prefix: string,
  files: FilesV1Payload['files'],
  stats: { count: number; bytes: number },
): Promise<void> {
  let entries: [string, vscode.FileType][];
  try {
    entries = await vscode.workspace.fs.readDirectory(dir);
  } catch {
    return;
  }

  for (const [name, type] of entries) {
    if (SKIP_NAMES.has(name) || name.startsWith('.git')) continue;
    const rel = prefix ? `${prefix}/${name}` : name;
    const child = vscode.Uri.joinPath(dir, name);

    if (type & vscode.FileType.Directory) {
      await walk(child, rel, files, stats);
      continue;
    }
    if (!(type & vscode.FileType.File)) continue;

    let data: Uint8Array;
    try {
      data = await vscode.workspace.fs.readFile(child);
    } catch {
      continue;
    }
    stats.count += 1;
    stats.bytes += data.byteLength;
    if (stats.count > MAX_FILES) {
      throw new Error(`Too many files to sync (max ${MAX_FILES})`);
    }
    if (stats.bytes > MAX_BYTES) {
      throw new Error(`Workspace too large to sync (max ${MAX_BYTES} bytes)`);
    }

    if (isMostlyText(data)) {
      files[rel] = { encoding: 'utf8', data: new TextDecoder('utf-8').decode(data) };
    } else {
      files[rel] = { encoding: 'base64', data: toBase64(data) };
    }
  }
}

/**
 * Export the active zcode-opfs (or first) workspace folder as files-v1.
 */
export async function collectWorkspaceFilesV1(): Promise<FilesV1Payload | null> {
  const folders = vscode.workspace.workspaceFolders ?? [];
  const folder =
    folders.find((f) => f.uri.scheme === 'zcode-opfs') ?? folders[0];
  if (!folder) return null;

  let workspaceId: string | undefined;
  if (folder.uri.scheme === 'zcode-opfs') {
    const parts = folder.uri.path.replace(/^\/+/, '').split('/').filter(Boolean);
    if (parts[0] === 'workspace' && parts[1]) workspaceId = parts[1];
  }

  const files: FilesV1Payload['files'] = {};
  const stats = { count: 0, bytes: 0 };
  await walk(folder.uri, '', files, stats);

  if (stats.count === 0) return null;

  return {
    format: 'files-v1',
    workspaceId,
    files,
  };
}
