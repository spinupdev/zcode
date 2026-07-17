/**
 * ZCode browser SCM: isomorphic-git over shared IDB (same as SPA / zcode-browser-fs).
 * Provides status, commit, push inside VS Code Web — not only the SPA tools surface.
 */
import { Buffer } from 'buffer';
import {
  createBrowserAgent,
  createBrowserAgentAsync,
  IdbFs,
  type GitChange,
  type ZCodeBrowserAgent,
} from '@zcode/browser-agent';
import type * as vscode from 'vscode';

declare const vscode: typeof import('vscode');

const g = globalThis as typeof globalThis & { Buffer?: typeof Buffer };
if (typeof g.Buffer === 'undefined') g.Buffer = Buffer;

const SCHEME = 'zcode-opfs';

function workspaceIdFromFolder(uri: vscode.Uri): string | undefined {
  const parts = uri.path.replace(/^\/+/, '').split('/').filter(Boolean);
  if (parts[0] === 'workspace' && parts[1]) return parts[1];
  return undefined;
}

function activeWorkspaceId(): string | undefined {
  for (const f of vscode.workspace.workspaceFolders ?? []) {
    if (f.uri.scheme === SCHEME) {
      return workspaceIdFromFolder(f.uri) ?? 'default';
    }
  }
  return undefined;
}

function fileUri(workspaceId: string, relPath: string): vscode.Uri {
  return vscode.Uri.from({
    scheme: SCHEME,
    path: `/workspace/${workspaceId}/${relPath.replace(/^\/+/, '')}`,
  });
}

function decorations(kind: GitChange['kind']): vscode.SourceControlResourceDecorations {
  const letter =
    kind === 'added' || kind === 'untracked'
      ? 'A'
      : kind === 'deleted'
        ? 'D'
        : 'M';
  const color =
    kind === 'deleted'
      ? new vscode.ThemeColor('gitDecoration.deletedResourceForeground')
      : kind === 'added' || kind === 'untracked'
        ? new vscode.ThemeColor('gitDecoration.addedResourceForeground')
        : new vscode.ThemeColor('gitDecoration.modifiedResourceForeground');
  return {
    strikeThrough: kind === 'deleted',
    faded: kind === 'untracked',
    tooltip: kind,
    letter,
    color,
  };
}

export function activate(context: vscode.ExtensionContext): void {
  // Start on IDB so SCM is live immediately; upgrade to OPFS (B2b) when ready.
  let agent = createBrowserAgent({
    fs: new IdbFs(),
    hydrateFromFs: true,
  }) as ZCodeBrowserAgent;

  void createBrowserAgentAsync({ hydrateFromFs: true }).then((upgraded) => {
    agent = upgraded as ZCodeBrowserAgent;
    void refresh();
  });

  const scm = vscode.scm.createSourceControl('zcode-git', 'ZCode Git');
  scm.inputBox.placeholder = 'Message (⌘Enter / Ctrl+Enter to commit)';
  scm.inputBox.visible = true;
  scm.acceptInputCommand = { command: 'zcode.git.commit', title: 'Commit' };
  scm.quickDiffProvider = {
    provideOriginalResource(uri: vscode.Uri): vscode.Uri | undefined {
      if (uri.scheme !== SCHEME) return undefined;
      // No blob store yet — skip original for quickDiff
      return undefined;
    },
  };

  const changesGroup = scm.createResourceGroup('changes', 'Changes');
  changesGroup.hideWhenEmpty = true;
  context.subscriptions.push(scm);

  let refreshBusy = false;

  const ensureWorkspace = async (id: string): Promise<void> => {
    const existing = await agent.listWorkspaces();
    if (existing.some((w) => w.id === id)) return;
    // SPA clone may predate meta file; register id pointing at IDB root
    if (!agent.store.get(id)) {
      agent.store.create(id, id);
    }
  };

  const refresh = async () => {
    if (refreshBusy) return;
    refreshBusy = true;
    try {
      const id = activeWorkspaceId();
      if (!id) {
        scm.count = 0;
        changesGroup.resourceStates = [];
        scm.statusBarCommands = [
          {
            command: 'zcode.git.clone',
            title: '$(cloud-download) Clone…',
            tooltip: 'Clone into browser workspace (SPA)',
          },
        ];
        return;
      }

      await ensureWorkspace(id);

      const [status, changes] = await Promise.all([
        agent.status(id),
        agent.listChanges(id),
      ]);

      scm.count = changes.length;
      changesGroup.resourceStates = changes.map((c) => ({
        resourceUri: fileUri(id, c.path),
        decorations: decorations(c.kind),
        command: {
          command: 'vscode.open',
          title: 'Open',
          arguments: [fileUri(id, c.path)],
        },
        contextValue: c.kind,
      }));

      const dirty = changes.length > 0 ? '*' : '';
      scm.statusBarCommands = [
        {
          command: 'zcode.git.refresh',
          title: `$(git-branch) ${status.branch}${dirty}`,
          tooltip: 'Refresh ZCode Git status',
        },
        {
          command: 'zcode.git.push',
          title: '$(cloud-upload) Push',
          tooltip: 'Push to origin via /git-proxy',
        },
      ];
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      scm.statusBarCommands = [
        {
          command: 'zcode.git.refresh',
          title: '$(warning) Git error',
          tooltip: msg,
        },
      ];
    } finally {
      refreshBusy = false;
    }
  };

  const proxyUrl = (): string => {
    const origin = globalThis.location?.origin ?? '';
    const configured = vscode.workspace.getConfiguration('zcode').get<string>('gitProxyUrl');
    return (configured && configured.trim()) || `${origin}/git-proxy`;
  };

  const tokenAuth = (): { username: string; password: string } | undefined => {
    const password = vscode.workspace.getConfiguration('zcode').get<string>('gitToken');
    if (!password?.trim()) return undefined;
    const username =
      vscode.workspace.getConfiguration('zcode').get<string>('gitUsername')?.trim() || 'git';
    return { username, password: password.trim() };
  };

  context.subscriptions.push(
    vscode.commands.registerCommand('zcode.git.refresh', () => void refresh()),
    vscode.commands.registerCommand('zcode.git.commit', async () => {
      const id = activeWorkspaceId();
      if (!id) {
        void vscode.window.showWarningMessage('Open a zcode-opfs workspace first.');
        return;
      }
      const message = scm.inputBox.value.trim();
      if (!message) {
        void vscode.window.showWarningMessage('Enter a commit message in the SCM input box.');
        return;
      }
      try {
        const { oid } = await agent.commit({
          workspaceId: id,
          message,
          author: {
            name: vscode.workspace.getConfiguration('zcode').get<string>('authorName') || 'ZCode',
            email:
              vscode.workspace.getConfiguration('zcode').get<string>('authorEmail') ||
              'zcode@localhost',
          },
        });
        scm.inputBox.value = '';
        void vscode.window.showInformationMessage(`Committed ${oid.slice(0, 7)}`);
        await refresh();
      } catch (err) {
        void vscode.window.showErrorMessage(
          `Commit failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }),
    vscode.commands.registerCommand('zcode.git.push', async () => {
      const id = activeWorkspaceId();
      if (!id) {
        void vscode.window.showWarningMessage('Open a zcode-opfs workspace first.');
        return;
      }
      try {
        await agent.push({
          workspaceId: id,
          corsProxyUrl: proxyUrl(),
          auth: tokenAuth(),
        });
        void vscode.window.showInformationMessage('Pushed to origin');
        await refresh();
      } catch (err) {
        void vscode.window.showErrorMessage(
          `Push failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }),
    vscode.commands.registerCommand('zcode.git.clone', async () => {
      const origin = globalThis.location?.origin ?? '';
      const proxy = proxyUrl();
      const url = await vscode.window.showInputBox({
        title: 'Clone Git repository (browser)',
        prompt: 'HTTPS git URL — clone runs in SPA with shared IDB, then reopen IDE',
        placeHolder: 'https://github.com/org/repo.git',
        ignoreFocusOut: true,
        validateInput: (v) => {
          if (!v.trim()) return 'URL required';
          if (!/^https:\/\//i.test(v.trim())) return 'Use an https:// URL';
          return undefined;
        },
      });
      if (!url) return;

      const spa = new URL('/', origin || 'http://127.0.0.1:5000');
      spa.searchParams.set('clone', url.trim());
      spa.searchParams.set('proxy', proxy);
      spa.searchParams.set('autoclone', '1');

      const pick = await vscode.window.showInformationMessage(
        `Clone uses the ZCode browser workspace (isomorphic-git + /git-proxy).\nProxy: ${proxy}`,
        'Open clone UI',
        'Cancel',
      );
      if (pick === 'Open clone UI') {
        await vscode.env.openExternal(vscode.Uri.parse(spa.toString()));
      }
    }),
  );

  context.subscriptions.push(
    vscode.workspace.onDidSaveTextDocument((doc) => {
      if (doc.uri.scheme === SCHEME) void refresh();
    }),
    vscode.workspace.onDidChangeWorkspaceFolders(() => void refresh()),
  );

  void refresh();
  // Periodic refresh (IDB edits from SPA / other tabs)
  const timer = setInterval(() => void refresh(), 8_000);
  context.subscriptions.push({ dispose: () => clearInterval(timer) });
}

export function deactivate(): void {
  /* no-op */
}
