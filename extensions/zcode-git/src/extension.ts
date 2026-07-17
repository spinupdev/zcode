/**
 * ZCode browser SCM: isomorphic-git over shared IDB/OPFS (same as SPA / zcode-browser-fs).
 * Provides status, commit, push, and in-IDE clone (HTTPS → /git-proxy) with VS Code notifications.
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

/** Mirrors @zcode/protocol CloneProgress — kept local to avoid extra dep. */
type CloneProgress = {
  phase: 'negotiating' | 'receiving' | 'resolving' | 'done';
  receivedObjects?: number;
  totalObjects?: number;
  message?: string;
};

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

function newWorkspaceId(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }
  return `ws-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function normalizeGitUrl(raw: string): string {
  let url = raw.trim();
  // owner/repo → github.com shorthand
  if (/^[\w.-]+\/[\w.-]+(?:\.git)?$/.test(url) && !url.includes('://')) {
    url = `https://github.com/${url.replace(/\.git$/, '')}.git`;
  }
  // Accept git@host:path → convert to https when possible
  const scp = url.match(/^git@([^:]+):(.+)$/);
  if (scp) {
    const host = scp[1]!;
    const path = scp[2]!.replace(/\.git$/, '');
    url = `https://${host}/${path}.git`;
  }
  // Strip trailing slash; ensure .git is optional (isomorphic-git accepts both)
  return url.replace(/\/+$/, '');
}

function validateGitUrl(raw: string): string | undefined {
  const t = raw.trim();
  if (!t) return 'URL required';
  const normalized = normalizeGitUrl(t);
  if (!/^https:\/\//i.test(normalized)) {
    return 'Use an https:// URL (browser clone does not support SSH remotes)';
  }
  try {
    const u = new URL(normalized);
    if (!u.hostname) return 'Invalid URL host';
  } catch {
    return 'Invalid URL';
  }
  return undefined;
}

function formatCloneProgress(p: CloneProgress): string {
  const loaded = p.receivedObjects ?? 0;
  const total = p.totalObjects ?? 0;
  if (p.phase === 'done') return 'clone complete';
  if (total > 0) return `${p.phase} ${loaded}/${total}`;
  if (p.message) return `${p.phase}: ${p.message}`;
  if (loaded) return `${p.phase} ${loaded}`;
  return p.phase;
}

function isAuthError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /401|403|auth|credential|Authentication|unauthorized|denied/i.test(msg);
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
            command: 'zcode.git.openRepository',
            title: '$(cloud-download) Open Repository…',
            tooltip: 'Clone any HTTPS git repo into the browser workspace',
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
        {
          command: 'zcode.git.openRepository',
          title: '$(repo-clone) Clone…',
          tooltip: 'Open / clone another HTTPS repository',
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

  /**
   * Modal-style open/clone flow:
   * 1) paste HTTPS URL (any git host)
   * 2) clone via isomorphic-git + /git-proxy
   * 3) progress + errors via VS Code notifications
   * 4) open zcode-opfs workspace
   */
  const openRepository = async (): Promise<void> => {
    const urlRaw = await vscode.window.showInputBox({
      title: 'Open Git Repository',
      prompt:
        'Paste an HTTPS git URL — GitHub, GitLab, Bitbucket, Codeberg, or any HTTPS git host',
      placeHolder: 'https://github.com/org/repo.git  ·  or  owner/repo',
      ignoreFocusOut: true,
      validateInput: validateGitUrl,
    });
    if (urlRaw == null) return;

    const url = normalizeGitUrl(urlRaw);
    let auth = tokenAuth();

    const runClone = async (authForClone?: { username: string; password: string }) => {
      const workspaceId = newWorkspaceId();
      const shortName =
        url.replace(/\/$/, '').split('/').pop()?.replace(/\.git$/, '') ?? workspaceId.slice(0, 8);

      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: `Cloning ${shortName}`,
          cancellable: false,
        },
        async (progress) => {
          progress.report({ message: 'connecting via /git-proxy…' });
          await agent.clone({
            workspaceId,
            url,
            corsProxyUrl: proxyUrl(),
            depth: 1,
            auth: authForClone,
            onProgress: (p) => {
              progress.report({ message: formatCloneProgress(p) });
            },
          });
          progress.report({ message: 'opening workspace…' });
        },
      );

      const folderUri = vscode.Uri.from({
        scheme: SCHEME,
        path: `/workspace/${workspaceId}`,
      });

      void vscode.window.showInformationMessage(
        `Cloned ${shortName} into browser workspace`,
      );

      await vscode.commands.executeCommand('vscode.openFolder', folderUri, {
        forceReuseWindow: true,
      });
    };

    try {
      await runClone(auth);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);

      if (isAuthError(err) && !auth) {
        const token = await vscode.window.showInputBox({
          title: 'Private repository — authentication required',
          prompt: 'Paste a personal access token (HTTPS). Stored only for this clone.',
          password: true,
          ignoreFocusOut: true,
          placeHolder: 'ghp_…  ·  glpat-…  ·  bitbucket app password',
        });
        if (token == null) {
          void vscode.window.showErrorMessage(`Clone cancelled: ${msg}`);
          return;
        }
        if (!token.trim()) {
          void vscode.window.showErrorMessage(`Clone failed: ${msg}`);
          return;
        }
        auth = {
          username:
            vscode.workspace.getConfiguration('zcode').get<string>('gitUsername')?.trim() ||
            'git',
          password: token.trim(),
        };
        try {
          await runClone(auth);
          return;
        } catch (retryErr) {
          void vscode.window.showErrorMessage(
            `Clone failed: ${retryErr instanceof Error ? retryErr.message : String(retryErr)}`,
          );
          return;
        }
      }

      void vscode.window.showErrorMessage(`Clone failed: ${msg}`);
    }
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
    // Primary open/clone entry (welcome "Open Repository", SCM, command palette)
    vscode.commands.registerCommand('zcode.git.openRepository', () => void openRepository()),
    vscode.commands.registerCommand('zcode.git.clone', () => void openRepository()),
    // VS Code Getting Started "Open Repository..." points at remoteHub — replace with ZCode clone.
    vscode.commands.registerCommand('remoteHub.openRepository', () => void openRepository()),
  );

  context.subscriptions.push(
    vscode.workspace.onDidSaveTextDocument((doc) => {
      if (doc.uri.scheme === SCHEME) void refresh();
    }),
    vscode.workspace.onDidChangeWorkspaceFolders(() => void refresh()),
  );

  void refresh();
  const timer = setInterval(() => void refresh(), 8_000);
  context.subscriptions.push({ dispose: () => clearInterval(timer) });
}

export function deactivate(): void {
  /* no-op */
}
