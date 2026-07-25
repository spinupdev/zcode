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

function folderUriFor(workspaceId: string): vscode.Uri {
  return vscode.Uri.from({ scheme: SCHEME, path: `/workspace/${workspaceId}` });
}

export function activate(context: vscode.ExtensionContext): void {
  // Start on shared IDB; upgrade to OPFS (same createDefaultFsInfo cache as zcode-git).
  const holder: { provider: IdbFileSystemProvider } = {
    provider: new IdbFileSystemProvider(new IdbFs(), storageLabel('idb')),
  };

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

  const fsReady = (async () => {
    try {
      const info = await createDefaultFsInfo();
      holder.provider.setFs(info.fs as AgentFs, storageLabel(info.kind));
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

  /**
   * Open (or switch to) a zcode-opfs workspace and refresh Explorer.
   * Used after clone so the tree shows isomorphic-git files on the shared FS.
   */
  const revealWorkspace = async (
    workspaceId: string,
    opts?: { name?: string; seedIfEmpty?: boolean },
  ): Promise<void> => {
    await fsReady;
    const id = workspaceId || 'default';
    if (opts?.seedIfEmpty !== false) {
      // Only seed empty default sample workspaces; never wipe a clone
      if (opts?.seedIfEmpty === true) {
        await holder.provider.seedIfEmpty(id);
      } else {
        // seed only if truly empty (seedIfEmpty already checks hasContent)
        await holder.provider.seedIfEmpty(id);
      }
    }
    const uri = folderUriFor(id);
    // Refresh provider watchers / explorer
    holder.provider.notifyChanged(uri, vscode.FileChangeType.Changed);
    try {
      const names = await holder.provider.readDirectory(uri);
      for (const [name] of names.slice(0, 50)) {
        holder.provider.notifyChanged(
          vscode.Uri.joinPath(uri, name),
          vscode.FileChangeType.Created,
        );
      }
    } catch {
      /* empty or not yet visible */
    }

    const name = opts?.name ?? id.slice(0, 24);
    const folders = vscode.workspace.workspaceFolders ?? [];
    const existingIdx = folders.findIndex(
      (f) => f.uri.scheme === SCHEME && workspaceIdFromFolder(f.uri) === id,
    );

    if (existingIdx >= 0) {
      // Already open — still fire refresh (Explorer can lag after clone)
      holder.provider.notifyChanged(uri, vscode.FileChangeType.Changed);
      try {
        await vscode.commands.executeCommand('revealInExplorer', uri);
      } catch {
        /* ignore */
      }
      return;
    }

    // Prefer in-place folder swap (avoids full reload when possible)
    const ok = vscode.workspace.updateWorkspaceFolders(
      0,
      folders.length,
      { uri, name },
    );
    if (!ok) {
      await vscode.commands.executeCommand('vscode.openFolder', uri, {
        forceReuseWindow: true,
      });
    } else {
      try {
        await vscode.commands.executeCommand('revealInExplorer', uri);
      } catch {
        /* ignore */
      }
    }
  };

  const openVirtualWorkspace = async (workspaceId?: string) => {
    const id =
      workspaceId ??
      (await vscode.window.showInputBox({
        title: 'Open ZCode virtual workspace',
        prompt: 'Workspace id (from SPA clone), or leave default',
        value: 'default',
      }));
    if (id == null) return;
    await revealWorkspace(id || 'default', { seedIfEmpty: true, name: id || 'default' });
  };

  context.subscriptions.push(
    vscode.commands.registerCommand('zcode.fs.openWorkspace', () => openVirtualWorkspace()),
    vscode.commands.registerCommand(
      'zcode.fs.revealWorkspace',
      (workspaceId: string, name?: string) =>
        revealWorkspace(workspaceId, { name, seedIfEmpty: false }),
    ),
  );

  // If workbench failed to open folderUri (common race), open default once provider is ready.
  void (async () => {
    try {
      await fsReady;
      await new Promise((r) => setTimeout(r, 300));
      const folders = vscode.workspace.workspaceFolders ?? [];
      const hasOpfs = folders.some((f) => f.uri.scheme === SCHEME);
      if (!hasOpfs) {
        const params = new URLSearchParams(globalThis.location?.search ?? '');
        const ws = params.get('workspace') || 'default';
        await revealWorkspace(ws, { seedIfEmpty: true, name: ws });
      }
    } catch (err) {
      console.warn('[zcode-browser-fs] auto-open workspace failed', err);
    }
  })();

  context.subscriptions.push(
    vscode.commands.registerCommand('zcode.fs.seedSample', async () => {
      await fsReady;
      const folder = vscode.workspace.workspaceFolders?.[0]?.uri;
      if (folder?.scheme !== SCHEME) {
        void vscode.window.showWarningMessage('Open a zcode-opfs folder first.');
        return;
      }
      const id = workspaceIdFromFolder(folder) ?? 'default';
      await holder.provider.seedIfEmpty(id);
      holder.provider.notifyChanged(folder, vscode.FileChangeType.Changed);
      void vscode.window.showInformationMessage(
        `Workspace ${id} ready (${holder.provider.storageLabel}; shared with SPA).`,
      );
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('zcode.fs.openSpa', async () => {
      const origin = globalThis.location?.origin ?? '';
      await vscode.env.openExternal(vscode.Uri.parse(`${origin}/debug/`));
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('zcode.fs.storageInfo', async () => {
      await fsReady;
      void vscode.window.showInformationMessage(`ZCode FS: ${holder.provider.storageLabel}`);
    }),
  );
}

export function deactivate(): void {
  /* no-op */
}
