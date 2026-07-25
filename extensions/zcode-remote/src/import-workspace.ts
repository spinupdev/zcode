/**
 * Apply files-v1 payload into a zcode-opfs (or any) workspace folder (WS3 detach).
 */
import * as vscode from 'vscode';
import type { FilesV1Payload } from './export-workspace.js';

function fromBase64(b64: string): Uint8Array {
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

/**
 * Write exported remote files under target folder root.
 * Overwrites existing paths; does not delete extra local files.
 */
export async function applyFilesV1ToFolder(
  folderUri: vscode.Uri,
  payload: FilesV1Payload,
): Promise<{ fileCount: number }> {
  let fileCount = 0;
  for (const [rel, entry] of Object.entries(payload.files)) {
    if (!rel || rel.includes('..')) continue;
    const parts = rel.split('/').filter(Boolean);
    if (parts.length === 0) continue;
    const dest = vscode.Uri.joinPath(folderUri, ...parts);
    // ensure parent dirs
    if (parts.length > 1) {
      const parent = vscode.Uri.joinPath(folderUri, ...parts.slice(0, -1));
      try {
        await vscode.workspace.fs.createDirectory(parent);
      } catch {
        /* may exist */
      }
    }
    const data =
      entry.encoding === 'base64'
        ? fromBase64(entry.data)
        : new TextEncoder().encode(entry.data);
    await vscode.workspace.fs.writeFile(dest, data);
    fileCount += 1;
  }
  return { fileCount };
}

/** Prefer existing zcode-opfs folder; otherwise create uri for workspace id. */
export function browserWorkspaceUri(workspaceId = 'default'): vscode.Uri {
  const folders = vscode.workspace.workspaceFolders ?? [];
  const existing = folders.find((f) => f.uri.scheme === 'zcode-opfs');
  if (existing) return existing.uri;
  return vscode.Uri.from({ scheme: 'zcode-opfs', path: `/workspace/${workspaceId}` });
}

export async function downloadRemoteExport(): Promise<FilesV1Payload | null> {
  const res = await fetch('/v1/workspace/export', {
    credentials: 'same-origin',
    cache: 'no-store',
  });
  if (res.status === 401 || res.status === 404) return null;
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(err.error ?? `export failed HTTP ${res.status}`);
  }
  const body = (await res.json()) as FilesV1Payload;
  if (body.format !== 'files-v1' || !body.files) {
    throw new Error('unexpected export format');
  }
  if (Object.keys(body.files).length === 0) return null;
  return body;
}
