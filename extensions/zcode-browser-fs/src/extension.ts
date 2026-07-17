/**
 * Web extension: zcode-opfs FileSystemProvider backed by shared IndexedDB
 * (same DB as SPA browser-agent). Clone in SPA → open /ide/?workspace=<id>.
 */
import type * as vscode from 'vscode';
import { IdbFileSystemProvider } from './idb-provider.js';

declare const vscode: typeof import('vscode');

const SCHEME = 'zcode-opfs';

function workspaceIdFromFolder(uri: vscode.Uri): string | undefined {
  // path: /workspace/<id> or /workspace/<id>/...
  const parts = uri.path.replace(/^\/+/, '').split('/').filter(Boolean);
  if (parts[0] === 'workspace' && parts[1]) return parts[1];
  return undefined;
}

export function activate(context: vscode.ExtensionContext): void {
  const provider = new IdbFileSystemProvider();
  context.subscriptions.push(
    vscode.workspace.registerFileSystemProvider(SCHEME, provider, {
      isCaseSensitive: true,
      isReadonly: false,
    }),
  );

  const seedFolder = async (uri: vscode.Uri) => {
    const id = workspaceIdFromFolder(uri) ?? 'default';
    await provider.seedIfEmpty(id);
  };

  // Seed current workspace folder(s)
  for (const f of vscode.workspace.workspaceFolders ?? []) {
    if (f.uri.scheme === SCHEME) {
      void seedFolder(f.uri);
    }
  }

  context.subscriptions.push(
    vscode.workspace.onDidChangeWorkspaceFolders((e) => {
      for (const f of e.added) {
        if (f.uri.scheme === SCHEME) void seedFolder(f.uri);
      }
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('zcode.fs.openWorkspace', async () => {
      const id = await vscode.window.showInputBox({
        title: 'Open ZCode virtual workspace',
        prompt: 'Workspace id (from SPA clone), or leave default',
        value: 'default',
      });
      if (id == null) return;
      const uri = vscode.Uri.from({ scheme: SCHEME, path: `/workspace/${id || 'default'}` });
      await provider.seedIfEmpty(id || 'default');
      await vscode.commands.executeCommand('vscode.openFolder', uri, { forceReuseWindow: true });
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('zcode.fs.seedSample', async () => {
      const folder = vscode.workspace.workspaceFolders?.[0]?.uri;
      if (folder?.scheme !== SCHEME) {
        void vscode.window.showWarningMessage('Open a zcode-opfs folder first.');
        return;
      }
      const id = workspaceIdFromFolder(folder) ?? 'default';
      // Force sample files even if content exists: write README only if missing is seedIfEmpty
      await provider.seedIfEmpty(id);
      void vscode.window.showInformationMessage(`Workspace ${id} ready (IDB shared with SPA).`);
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('zcode.fs.openSpa', async () => {
      const origin = globalThis.location?.origin ?? '';
      await vscode.env.openExternal(vscode.Uri.parse(`${origin}/`));
    }),
  );
}

export function deactivate(): void {
  /* no-op */
}
