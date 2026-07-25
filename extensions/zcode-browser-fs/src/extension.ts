/**
 * Web extension: zcode-opfs FileSystemProvider.
 * B2b: prefers OPFS (ZenFS) when available; falls back to shared IndexedDB (B7).
 * Clone in debug SPA (/debug/) → open /?workspace=<id>.
 */
import { createDefaultFsInfo, IdbFs, type AgentFs } from '@zcode/browser-agent';
import * as vscode from 'vscode';
import { IdbFileSystemProvider } from './idb-provider.js';

const SCHEME = 'zcode-opfs';

function workspaceIdFromFolder(uri: vscode.Uri): string | undefined {
  const parts = uri.path.replace(/^\/+/, '').split('/').filter(Boolean);
  if (parts[0] === 'workspace' && parts[1]) return parts[1];
  return undefined;
}

function storageLabel(kind: string): string {
  if (kind === 'opfs') return 'OPFS via ZenFS (primary)';
  if (kind === 'idb') return 'IndexedDB zcode-fs-v1';
  return 'in-memory FS';
}

export function activate(context: vscode.ExtensionContext): void {
  // Mutable holder so async OPFS upgrade updates the same registered provider.
  const holder: { provider: IdbFileSystemProvider } = {
    provider: new IdbFileSystemProvider(new IdbFs(), storageLabel('idb')),
  };

  /** Delegating provider so we can swap the backing AgentFs without re-registering. */
  const facade: vscode.FileSystemProvider = {
    get onDidChangeFile() {
      return holder.provider.onDidChangeFile;
    },
    watch: (uri, opts) => holder.provider.watch(uri, opts),
    stat: (uri) => holder.provider.stat(uri),
    readDirectory: (uri) => holder.provider.readDirectory(uri),
    createDirectory: (uri) => holder.provider.createDirectory(uri),
    readFile: (uri) => holder.provider.readFile(uri),
    writeFile: (uri, content, opts) => holder.provider.writeFile(uri, content, opts),
    delete: (uri, opts) => holder.provider.delete(uri, opts),
    rename: (oldUri, newUri, opts) => holder.provider.rename(oldUri, newUri, opts),
  };

  context.subscriptions.push(
    vscode.workspace.registerFileSystemProvider(SCHEME, facade, {
      isCaseSensitive: true,
      isReadonly: false,
    }),
  );

  const seedFolder = async (uri: vscode.Uri) => {
    const id = workspaceIdFromFolder(uri) ?? 'default';
    await holder.provider.seedIfEmpty(id);
  };

  void (async () => {
    try {
      const info = await createDefaultFsInfo();
      holder.provider = new IdbFileSystemProvider(
        info.fs as AgentFs,
        storageLabel(info.kind),
      );
    } catch {
      /* keep IDB */
    }
    for (const f of vscode.workspace.workspaceFolders ?? []) {
      if (f.uri.scheme === SCHEME) void seedFolder(f.uri);
    }
  })();

  for (const f of vscode.workspace.workspaceFolders ?? []) {
    if (f.uri.scheme === SCHEME) void seedFolder(f.uri);
  }

  context.subscriptions.push(
    vscode.workspace.onDidChangeWorkspaceFolders((e) => {
      for (const f of e.added) {
        if (f.uri.scheme === SCHEME) void seedFolder(f.uri);
      }
    }),
  );

  const openVirtualWorkspace = async (workspaceId?: string) => {
    const id =
      workspaceId ??
      (await vscode.window.showInputBox({
        title: 'Open ZCode virtual workspace',
        prompt: 'Workspace id (from SPA clone), or leave default',
        value: 'default',
      }));
    if (id == null) return;
    const ws = id || 'default';
    const uri = vscode.Uri.from({ scheme: SCHEME, path: `/workspace/${ws}` });
    await holder.provider.seedIfEmpty(ws);
    await vscode.commands.executeCommand('vscode.openFolder', uri, { forceReuseWindow: true });
  };

  context.subscriptions.push(
    vscode.commands.registerCommand('zcode.fs.openWorkspace', () => openVirtualWorkspace()),
  );

  // If workbench failed to open folderUri (common race), open default once provider is ready.
  void (async () => {
    try {
      await new Promise((r) => setTimeout(r, 400));
      const folders = vscode.workspace.workspaceFolders ?? [];
      const hasOpfs = folders.some((f) => f.uri.scheme === SCHEME);
      if (!hasOpfs) {
        const params = new URLSearchParams(globalThis.location?.search ?? '');
        const ws = params.get('workspace') || 'default';
        await openVirtualWorkspace(ws);
      }
    } catch (err) {
      console.warn('[zcode-browser-fs] auto-open workspace failed', err);
    }
  })();

  context.subscriptions.push(
    vscode.commands.registerCommand('zcode.fs.seedSample', async () => {
      const folder = vscode.workspace.workspaceFolders?.[0]?.uri;
      if (folder?.scheme !== SCHEME) {
        void vscode.window.showWarningMessage('Open a zcode-opfs folder first.');
        return;
      }
      const id = workspaceIdFromFolder(folder) ?? 'default';
      await holder.provider.seedIfEmpty(id);
      void vscode.window.showInformationMessage(
        `Workspace ${id} ready (${holder.provider.storageLabel}; shared with SPA).`,
      );
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('zcode.fs.openSpa', async () => {
      const origin = globalThis.location?.origin ?? '';
      await vscode.env.openExternal(vscode.Uri.parse(`${origin}/`));
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('zcode.fs.storageInfo', async () => {
      void vscode.window.showInformationMessage(`ZCode FS: ${holder.provider.storageLabel}`);
    }),
  );
}

export function deactivate(): void {
  /* no-op */
}
