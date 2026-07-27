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

/** Navigate so product.json re-opens folderUri for this workspace id (web fallback). */
function reloadWithWorkspace(workspaceId: string): void {
  try {
    const loc = globalThis.location;
    if (!loc?.href) return;
    const u = new URL(loc.href);
    u.searchParams.set('workspace', workspaceId);
    loc.assign(u.toString());
  } catch (err) {
    console.warn('[zcode-browser-fs] reloadWithWorkspace failed', err);
  }
}

async function refreshExplorer(): Promise<void> {
  for (const cmd of [
    'workbench.files.action.refreshFilesExplorer',
    'workbench.view.explorer',
  ]) {
    try {
      await vscode.commands.executeCommand(cmd);
    } catch {
      /* command may not exist on all builds */
    }
  }
}

export function activate(context: vscode.ExtensionContext): void {
  // Start on shared IDB; upgrade to OPFS (same createDefaultFsInfo cache as zcode-git).
  const holder: { provider: IdbFileSystemProvider } = {
    provider: new IdbFileSystemProvider(new IdbFs(), storageLabel('idb')),
  };

  let fsReadyResolve!: () => void;
  const fsReady = new Promise<void>((r) => {
    fsReadyResolve = r;
  });
  let fsReadyDone = false;

  const ensureFs = async (): Promise<void> => {
    if (fsReadyDone) return;
    // Never hang Explorer forever if OPFS init stalls
    await Promise.race([
      fsReady,
      new Promise<void>((r) => setTimeout(r, 10_000)),
    ]);
    fsReadyDone = true;
  };

  /**
   * Gate every provider op on shared FS upgrade. Without this, Explorer can
   * list the temporary empty IdbFs before OPFS is swapped in, then never
   * re-query — SCM (git agent) sees the clone, Explorer stays empty.
   */
  const facade: vscode.FileSystemProvider = {
    get onDidChangeFile() {
      return holder.provider.onDidChangeFile;
    },
    watch: (uri, opts) => holder.provider.watch(uri, opts),
    stat: async (uri) => {
      await ensureFs();
      return holder.provider.stat(uri);
    },
    readDirectory: async (uri) => {
      await ensureFs();
      return holder.provider.readDirectory(uri);
    },
    createDirectory: async (uri) => {
      await ensureFs();
      return holder.provider.createDirectory(uri);
    },
    readFile: async (uri) => {
      await ensureFs();
      return holder.provider.readFile(uri);
    },
    writeFile: async (uri, content, opts) => {
      await ensureFs();
      return holder.provider.writeFile(uri, content, opts);
    },
    delete: async (uri, opts) => {
      await ensureFs();
      return holder.provider.delete(uri, opts);
    },
    rename: async (oldUri, newUri, opts) => {
      await ensureFs();
      return holder.provider.rename(oldUri, newUri, opts);
    },
  };

  context.subscriptions.push(
    vscode.workspace.registerFileSystemProvider(SCHEME, facade, {
      isCaseSensitive: true,
      isReadonly: false,
    }),
  );

  /** Ensure folder exists; strip leftover hello.* seed samples; never auto-seed. */
  const prepareFolder = async (uri: vscode.Uri) => {
    await ensureFs();
    const id = workspaceIdFromFolder(uri) ?? 'default';
    if (await holder.provider.hasGit(id)) {
      await holder.provider.notifyTree(id, uri);
      return;
    }
    // Remove dogfood hello.js / hello.py samples from older builds
    await holder.provider.clearSeedIfOnlySamples(id);
    await holder.provider.ensureWorkspaceRoot(id);
  };

  void (async () => {
    try {
      const info = await createDefaultFsInfo();
      holder.provider.setFs(info.fs as AgentFs, storageLabel(info.kind));
    } catch (err) {
      console.warn('[zcode-browser-fs] createDefaultFsInfo failed, keeping IDB', err);
    } finally {
      fsReadyDone = true;
      fsReadyResolve();
    }
    // Re-notify any open folders so Explorer re-lists on the real backend
    for (const f of vscode.workspace.workspaceFolders ?? []) {
      if (f.uri.scheme === SCHEME) {
        const id = workspaceIdFromFolder(f.uri) ?? 'default';
        try {
          await prepareFolder(f.uri);
          await holder.provider.notifyTree(id, f.uri);
        } catch {
          holder.provider.notifyChanged(f.uri, vscode.FileChangeType.Changed);
        }
      }
    }
    await refreshExplorer();
  })();

  context.subscriptions.push(
    vscode.workspace.onDidChangeWorkspaceFolders((e) => {
      for (const f of e.added) {
        if (f.uri.scheme === SCHEME) {
          void (async () => {
            await prepareFolder(f.uri);
            const id = workspaceIdFromFolder(f.uri) ?? 'default';
            await holder.provider.notifyTree(id, f.uri);
            await refreshExplorer();
          })();
        }
      }
    }),
  );

  const isWorkspaceOpen = (id: string): boolean =>
    (vscode.workspace.workspaceFolders ?? []).some(
      (f) => f.uri.scheme === SCHEME && workspaceIdFromFolder(f.uri) === id,
    );

  /**
   * Open (or switch to) a zcode-opfs workspace and refresh Explorer.
   * Used after clone so the tree shows isomorphic-git files on the shared FS.
   */
  const revealWorkspace = async (
    workspaceId: string,
    opts?: { name?: string; seedIfEmpty?: boolean; allowReload?: boolean },
  ): Promise<boolean> => {
    await ensureFs();
    const id = workspaceId || 'default';
    // seedIfEmpty is legacy; startup no longer seeds. Explicit seed uses seedSample command.
    await holder.provider.ensureWorkspaceRoot(id);

    // Remember for reopen / multi-project switch (OPFS/IDB holds the bytes)
    try {
      globalThis.localStorage?.setItem('zcode.lastWorkspaceId', id);
    } catch {
      /* private mode */
    }

    const uri = folderUriFor(id);

    // Prove the provider can see the tree (and log if not — dual-FS regression)
    let entryCount = 0;
    try {
      const names = await holder.provider.readDirectory(uri);
      entryCount = names.length;
      console.info(
        `[zcode-browser-fs] revealWorkspace ${id}: ${entryCount} top-level entries`,
        names.slice(0, 12).map(([n]) => n),
      );
    } catch (err) {
      console.warn(`[zcode-browser-fs] revealWorkspace ${id}: readDirectory failed`, err);
    }

    // Always fire full tree events so Explorer rebuilds after external clone writes
    const fileCount = await holder.provider.notifyTree(id, uri);
    console.info(`[zcode-browser-fs] revealWorkspace ${id}: notified ${fileCount} files`);

    const name = opts?.name ?? id.slice(0, 24);
    const folders = vscode.workspace.workspaceFolders ?? [];
    const existingIdx = folders.findIndex(
      (f) => f.uri.scheme === SCHEME && workspaceIdFromFolder(f.uri) === id,
    );

    if (existingIdx >= 0) {
      await refreshExplorer();
      try {
        await vscode.commands.executeCommand('revealInExplorer', uri);
      } catch {
        /* ignore */
      }
      return true;
    }

    // Prefer in-place folder swap (avoids full reload when possible)
    const ok = vscode.workspace.updateWorkspaceFolders(0, folders.length, { uri, name });
    if (ok) {
      // Wait for folder change event (async in VS Code)
      await new Promise<void>((resolve) => {
        const sub = vscode.workspace.onDidChangeWorkspaceFolders(() => {
          sub.dispose();
          resolve();
        });
        setTimeout(() => {
          sub.dispose();
          resolve();
        }, 500);
      });
      if (isWorkspaceOpen(id)) {
        await holder.provider.notifyTree(id, uri);
        await refreshExplorer();
        try {
          await vscode.commands.executeCommand('revealInExplorer', uri);
        } catch {
          /* ignore */
        }
        // If still empty after switch, hard-reload so folderUri boots correctly
        if (entryCount === 0 && fileCount === 0 && opts?.allowReload !== false) {
          console.info(
            `[zcode-browser-fs] workspace ${id} open but empty after swap; reloading`,
          );
          reloadWithWorkspace(id);
          return false;
        }
        return true;
      }
    }

    // openFolder on web often no-ops for custom schemes; try then verify
    try {
      await vscode.commands.executeCommand('vscode.openFolder', uri, {
        forceReuseWindow: true,
      });
    } catch {
      /* ignore */
    }
    await new Promise((r) => setTimeout(r, 150));
    if (isWorkspaceOpen(id)) {
      await holder.provider.notifyTree(id, uri);
      await refreshExplorer();
      return true;
    }

    // Last resort: reload workbench with ?workspace=<id>
    if (opts?.allowReload !== false) {
      console.info(
        `[zcode-browser-fs] folder switch failed for ${id}; reloading with ?workspace=`,
      );
      reloadWithWorkspace(id);
      return false;
    }
    return false;
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
    await revealWorkspace(id || 'default', { seedIfEmpty: false, name: id || 'default' });
  };

  context.subscriptions.push(
    vscode.commands.registerCommand('zcode.fs.openWorkspace', () => openVirtualWorkspace()),
    vscode.commands.registerCommand(
      'zcode.fs.revealWorkspace',
      (workspaceId: string, name?: string) =>
        revealWorkspace(workspaceId, { name, seedIfEmpty: false, allowReload: true }),
    ),
    // Silent wait for OPFS/IDB upgrade (clone calls this — do not toast)
    vscode.commands.registerCommand('zcode.fs.ready', async () => {
      await ensureFs();
      return holder.provider.storageLabel;
    }),
    // Debug: force re-list current folder
    vscode.commands.registerCommand('zcode.fs.refreshExplorer', async () => {
      await ensureFs();
      for (const f of vscode.workspace.workspaceFolders ?? []) {
        if (f.uri.scheme !== SCHEME) continue;
        const id = workspaceIdFromFolder(f.uri) ?? 'default';
        await holder.provider.notifyTree(id, f.uri);
      }
      await refreshExplorer();
    }),
  );

  // If workbench failed to open folderUri (common race), open last/default once provider is ready.
  void (async () => {
    try {
      await ensureFs();
      await new Promise((r) => setTimeout(r, 300));
      const folders = vscode.workspace.workspaceFolders ?? [];
      const hasOpfs = folders.some((f) => f.uri.scheme === SCHEME);
      if (!hasOpfs) {
        const params = new URLSearchParams(globalThis.location?.search ?? '');
        let last = '';
        try {
          last = globalThis.localStorage?.getItem('zcode.lastWorkspaceId')?.trim() || '';
        } catch {
          /* private mode */
        }
        const ws = params.get('workspace') || last || 'default';
        await revealWorkspace(ws, {
          seedIfEmpty: false,
          name: ws,
          allowReload: false,
        });
      } else {
        // Folder already open from product.json — clean seed leftovers + re-notify
        for (const f of folders) {
          if (f.uri.scheme !== SCHEME) continue;
          const id = workspaceIdFromFolder(f.uri) ?? 'default';
          try {
            globalThis.localStorage?.setItem('zcode.lastWorkspaceId', id);
          } catch {
            /* ignore */
          }
          await prepareFolder(f.uri);
          await holder.provider.notifyTree(id, f.uri);
        }
        await refreshExplorer();
      }
    } catch (err) {
      console.warn('[zcode-browser-fs] auto-open workspace failed', err);
    }
  })();

  context.subscriptions.push(
    vscode.commands.registerCommand('zcode.fs.seedSample', async () => {
      await ensureFs();
      const folder = vscode.workspace.workspaceFolders?.[0]?.uri;
      if (folder?.scheme !== SCHEME) {
        void vscode.window.showWarningMessage('Open a zcode-opfs folder first.');
        return;
      }
      const id = workspaceIdFromFolder(folder) ?? 'default';
      await holder.provider.seedSample(id, { force: true });
      await holder.provider.notifyTree(id, folder);
      await refreshExplorer();
      void vscode.window.showInformationMessage(
        `Sample files added to ${id} (${holder.provider.storageLabel}).`,
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
      await ensureFs();
      void vscode.window.showInformationMessage(`ZCode FS: ${holder.provider.storageLabel}`);
    }),
  );
}

export function deactivate(): void {
  /* no-op */
}
