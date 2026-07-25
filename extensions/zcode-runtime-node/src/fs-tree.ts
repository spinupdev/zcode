/**
 * Build a WebContainer FileSystemTree from a vscode workspace folder.
 */
import * as vscode from 'vscode';

export type FileNode = { file: { contents: string } };
export type DirectoryNode = { directory: FileSystemTree };
export type FileSystemTree = Record<string, FileNode | DirectoryNode>;

const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'out',
  '.turbo',
  'coverage',
  '.cache',
]);

const ALLOW_DOTFILES = new Set(['.env', '.gitignore', '.npmrc', '.nvmrc']);

const MAX_FILES = 400;
const MAX_BYTES = 8 * 1024 * 1024;
const MAX_FILE_BYTES = 512 * 1024;

function isTexty(name: string, bytes: Uint8Array): boolean {
  if (/\.(png|jpe?g|gif|webp|ico|woff2?|ttf|eot|zip|gz|wasm|mp[34]|pdf|bin)$/i.test(name)) {
    return false;
  }
  const n = Math.min(bytes.length, 256);
  for (let i = 0; i < n; i++) {
    if (bytes[i] === 0) return false;
  }
  return true;
}

/**
 * Recursively read dir into a WebContainer-compatible tree.
 */
export async function buildFileSystemTree(
  root: vscode.Uri,
  opts: { maxFiles?: number; maxBytes?: number } = {},
): Promise<{ tree: FileSystemTree; fileCount: number; bytes: number; skipped: string[] }> {
  const maxFiles = opts.maxFiles ?? MAX_FILES;
  const maxBytes = opts.maxBytes ?? MAX_BYTES;
  const tree: FileSystemTree = {};
  let fileCount = 0;
  let bytes = 0;
  const skipped: string[] = [];

  async function walk(dir: vscode.Uri, target: FileSystemTree, prefix: string): Promise<void> {
    let entries: [string, vscode.FileType][];
    try {
      entries = await vscode.workspace.fs.readDirectory(dir);
    } catch {
      return;
    }
    for (const [name, type] of entries) {
      if (name === '.DS_Store') continue;
      if (name.startsWith('.') && !ALLOW_DOTFILES.has(name)) continue;

      const child = vscode.Uri.joinPath(dir, name);
      const rel = prefix ? `${prefix}/${name}` : name;

      if (type & vscode.FileType.Directory) {
        if (SKIP_DIRS.has(name)) continue;
        const dirNode: DirectoryNode = { directory: {} };
        target[name] = dirNode;
        await walk(child, dirNode.directory, rel);
        if (Object.keys(dirNode.directory).length === 0) {
          delete target[name];
        }
        continue;
      }

      if (!(type & vscode.FileType.File)) continue;
      if (fileCount >= maxFiles) {
        skipped.push(rel);
        continue;
      }

      let data: Uint8Array;
      try {
        data = await vscode.workspace.fs.readFile(child);
      } catch {
        skipped.push(rel);
        continue;
      }
      if (data.byteLength > MAX_FILE_BYTES || !isTexty(name, data)) {
        skipped.push(rel);
        continue;
      }
      if (bytes + data.byteLength > maxBytes) {
        skipped.push(rel);
        continue;
      }
      target[name] = { file: { contents: new TextDecoder('utf-8').decode(data) } };
      fileCount += 1;
      bytes += data.byteLength;
    }
  }

  await walk(root, tree, '');
  return { tree, fileCount, bytes, skipped };
}

export function workspaceFolderFor(uri?: vscode.Uri): vscode.WorkspaceFolder | undefined {
  if (uri) {
    const f = vscode.workspace.getWorkspaceFolder(uri);
    if (f) return f;
  }
  const folders = vscode.workspace.workspaceFolders ?? [];
  return folders.find((f) => f.uri.scheme === 'zcode-opfs') ?? folders[0];
}

export function relativeWorkspacePath(fileUri: vscode.Uri, folder: vscode.WorkspaceFolder): string {
  const root = folder.uri.path.replace(/\/$/, '');
  const full = fileUri.path;
  if (full === root) return '';
  if (full.startsWith(`${root}/`)) {
    return full.slice(root.length + 1);
  }
  const parts = full.split('/').filter(Boolean);
  const rootParts = root.split('/').filter(Boolean);
  let i = 0;
  while (i < rootParts.length && parts[i] === rootParts[i]) i++;
  return parts.slice(i).join('/');
}

export function hasPackageJson(tree: FileSystemTree): boolean {
  const node = tree['package.json'];
  return Boolean(node && 'file' in node);
}
