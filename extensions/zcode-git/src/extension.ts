/**
 * ZCode browser SCM: isomorphic-git over shared OPFS/IDB (same as SPA / zcode-browser-fs).
 * Provides status, commit, push, multi-project clone, and Browser Projects view.
 *
 * Persistence: clones land under workspace/<id>/ on OPFS (primary) or IndexedDB zcode-fs-v1.
 * Last-opened workspace id is also stored in localStorage so reopen restores the same project.
 */
import { Buffer } from 'buffer';
import {
  createBrowserAgentAsync,
  type GitChange,
  type ZCodeBrowserAgent,
} from '@zcode/browser-agent';
import * as vscode from 'vscode';

/** Subset of agent WorkspaceInfo used by the projects UI. */
type WorkspaceInfo = {
  id: string;
  name: string;
  uri: string;
  createdAt: string;
  approxBytes?: number;
  origin?: string;
};

/** Mirrors @zcode/protocol CloneProgress — kept local to avoid extra dep. */
type CloneProgress = {
  phase: 'negotiating' | 'receiving' | 'resolving' | 'done';
  receivedObjects?: number;
  totalObjects?: number;
  message?: string;
};

const g = globalThis as typeof globalThis & { Buffer?: typeof Buffer };
if (typeof g.Buffer === 'undefined') g.Buffer = Buffer;

const SCHEME = 'zcode-opfs';
const LAST_WS_KEY = 'zcode.lastWorkspaceId';
/** Skip auto welcome/clone prompt once per browser origin session after dismiss. */
const SKIP_WELCOME_KEY = 'zcode.skipWelcomePrompt';

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
  // @types/vscode may lag web SCM decoration fields (letter/color)
  return {
    strikeThrough: kind === 'deleted',
    faded: kind === 'untracked',
    tooltip: `${kind}${letter ? ` (${letter})` : ''}`,
    letter,
    color,
  } as vscode.SourceControlResourceDecorations;
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

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

function shortNameFromUrl(url: string): string {
  return url.replace(/\/$/, '').split('/').pop()?.replace(/\.git$/, '') || 'repo';
}

/** Human-readable workspace id from repo name (stable URL segment). */
function slugFromRepoName(name: string): string {
  const s = name
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return s || 'repo';
}

async function allocateWorkspaceId(
  a: ZCodeBrowserAgent,
  preferred: string,
): Promise<string> {
  const existing = new Set((await a.listWorkspaces()).map((w) => w.id));
  if (!existing.has(preferred)) return preferred;
  for (let i = 2; i < 200; i++) {
    const id = `${preferred}-${i}`;
    if (!existing.has(id)) return id;
  }
  return `${preferred}-${Date.now().toString(36)}`;
}

function readLastWorkspaceId(): string | undefined {
  try {
    const v = globalThis.localStorage?.getItem(LAST_WS_KEY);
    return v?.trim() || undefined;
  } catch {
    return undefined;
  }
}

function writeLastWorkspaceId(id: string): void {
  try {
    globalThis.localStorage?.setItem(LAST_WS_KEY, id);
  } catch {
    /* private mode */
  }
  // Keep URL in sync so reload / share opens the same project
  try {
    const loc = globalThis.location;
    if (!loc?.href) return;
    const u = new URL(loc.href);
    if (u.searchParams.get('workspace') === id) return;
    u.searchParams.set('workspace', id);
    globalThis.history?.replaceState?.(null, '', u.toString());
  } catch {
    /* ignore */
  }
}

async function requestPersistentStorage(): Promise<void> {
  try {
    const storage = (globalThis.navigator as Navigator & {
      storage?: { persist?: () => Promise<boolean>; persisted?: () => Promise<boolean> };
    })?.storage;
    if (!storage?.persist) return;
    const already = (await storage.persisted?.()) === true;
    if (already) return;
    const ok = await storage.persist();
    console.info(`[zcode-git] navigator.storage.persist() → ${ok}`);
  } catch (err) {
    console.warn('[zcode-git] storage.persist failed', err);
  }
}

/** True when workspace has user/git content (not empty meta-only). */
async function workspaceHasContent(
  a: ZCodeBrowserAgent,
  id: string,
): Promise<boolean> {
  try {
    // listFiles already strips .git; treat meta-only trees as empty
    const files = await a.listFiles(id);
    return files.some(
      (f) => f !== '.zcode-workspace.json' && !f.endsWith('/.zcode-workspace.json'),
    );
  } catch {
    return false;
  }
}

class ProjectItem extends vscode.TreeItem {
  constructor(
    public readonly workspace: WorkspaceInfo,
    public readonly isActive: boolean,
  ) {
    super(workspace.name, vscode.TreeItemCollapsibleState.None);
    this.id = workspace.id;
    this.description = isActive
      ? 'current'
      : workspace.origin
        ? workspace.origin.replace(/^https:\/\//, '')
        : workspace.id;
    this.tooltip = [
      workspace.name,
      `id: ${workspace.id}`,
      workspace.origin ? `origin: ${workspace.origin}` : undefined,
      `created: ${workspace.createdAt}`,
      isActive ? '(open)' : undefined,
    ]
      .filter(Boolean)
      .join('\n');
    this.iconPath = new vscode.ThemeIcon(isActive ? 'folder-active' : 'repo');
    this.contextValue = isActive ? 'zcodeProjectActive' : 'zcodeProject';
    this.command = {
      command: 'zcode.git.openProject',
      title: 'Open Project',
      arguments: [workspace.id],
    };
  }
}

class ProjectsTreeProvider implements vscode.TreeDataProvider<ProjectItem> {
  private readonly _onDidChange = new vscode.EventEmitter<ProjectItem | undefined | null | void>();
  readonly onDidChangeTreeData = this._onDidChange.event;
  private items: WorkspaceInfo[] = [];

  constructor(private readonly getAgent: () => Promise<ZCodeBrowserAgent>) {}

  refresh(): void {
    this._onDidChange.fire();
  }

  async getChildren(element?: ProjectItem): Promise<ProjectItem[]> {
    if (element) return [];
    try {
      const a = await this.getAgent();
      this.items = await a.listWorkspaces();
      // Prefer projects with content / origin first; hide empty "default" if others exist
      const active = activeWorkspaceId();
      const enriched = await Promise.all(
        this.items.map(async (w) => ({
          w,
          has: await workspaceHasContent(a, w.id),
        })),
      );
      const meaningful = enriched.filter(
        (e) => e.has || e.w.origin || e.w.id === active || e.w.id !== 'default',
      );
      const list = (meaningful.length ? meaningful : enriched).map((e) => e.w);
      list.sort((a, b) => {
        if (a.id === active) return -1;
        if (b.id === active) return 1;
        return (b.createdAt || '').localeCompare(a.createdAt || '');
      });
      return list.map((w) => new ProjectItem(w, w.id === active));
    } catch (err) {
      console.warn('[zcode-git] projects tree', err);
      return [];
    }
  }

  getTreeItem(element: ProjectItem): vscode.TreeItem {
    return element;
  }
}

export function activate(context: vscode.ExtensionContext): void {
  /**
   * Shared default FS (OPFS→IDB) via createBrowserAgentAsync.
   * Never block activate on FS — clone path awaits with a timeout.
   */
  let agent: ZCodeBrowserAgent | null = null;
  let agentPromise: Promise<ZCodeBrowserAgent> | null = null;

  const getAgent = (): Promise<ZCodeBrowserAgent> => {
    if (agent) return Promise.resolve(agent);
    if (!agentPromise) {
      agentPromise = createBrowserAgentAsync({ hydrateFromFs: true })
        .then((upgraded) => {
          agent = upgraded as ZCodeBrowserAgent;
          void refresh();
          projectsTree.refresh();
          return agent;
        })
        .catch((err) => {
          agentPromise = null;
          throw err;
        });
    }
    return agentPromise;
  };

  // Kick off FS init + durable storage request in background
  void getAgent().catch((err) => {
    console.warn('[zcode-git] background agent init failed', err);
  });
  void requestPersistentStorage();

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

  const projectsTree = new ProjectsTreeProvider(getAgent);
  const treeView = vscode.window.createTreeView('zcode.projects', {
    treeDataProvider: projectsTree,
    showCollapseAll: false,
  });
  context.subscriptions.push(treeView);

  const projectStatus = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Left,
    100,
  );
  projectStatus.command = 'zcode.git.manageProjects';
  projectStatus.tooltip = 'Switch or manage browser projects (OPFS/IndexedDB)';
  projectStatus.show();
  context.subscriptions.push(projectStatus);

  let refreshBusy = false;
  let openRepoBusy = false;

  const ensureWorkspace = async (id: string): Promise<void> => {
    const a = await getAgent();
    const existing = await a.listWorkspaces();
    if (existing.some((w) => w.id === id)) return;
    if (!a.store.get(id)) {
      a.store.create(id, id);
    }
  };

  const updateProjectStatus = (label?: string) => {
    const id = activeWorkspaceId();
    const name = label || id || 'no project';
    projectStatus.text = `$(repo) ${name}`;
  };

  const refresh = async () => {
    if (refreshBusy) return;
    refreshBusy = true;
    try {
      const a = await getAgent().catch(() => null);
      if (!a) {
        scm.statusBarCommands = [
          {
            command: 'zcode.git.openRepository',
            title: '$(cloud-download) Open Repository…',
            tooltip: 'Clone any HTTPS git repo into the browser workspace',
          },
        ];
        updateProjectStatus('…');
        return;
      }
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
          {
            command: 'zcode.git.manageProjects',
            title: '$(folder-library) Projects',
            tooltip: 'Browse browser projects',
          },
        ];
        updateProjectStatus('no project');
        return;
      }

      await ensureWorkspace(id);
      writeLastWorkspaceId(id);

      const [status, changes, list] = await Promise.all([
        a.status(id).catch(() => ({ branch: '—', dirty: false, ahead: 0, behind: 0 })),
        a.listChanges(id).catch(() => [] as GitChange[]),
        a.listWorkspaces(),
      ]);

      const meta = list.find((w) => w.id === id);
      updateProjectStatus(meta?.name || id);

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
          tooltip: 'Clone another HTTPS repository into a new browser project',
        },
        {
          command: 'zcode.git.manageProjects',
          title: '$(folder-library) Projects',
          tooltip: 'Switch browser projects',
        },
      ];
      projectsTree.refresh();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      scm.statusBarCommands = [
        {
          command: 'zcode.git.refresh',
          title: '$(warning) Git error',
          tooltip: msg,
        },
        {
          command: 'zcode.git.openRepository',
          title: '$(repo-clone) Clone…',
          tooltip: 'Open / clone another HTTPS repository',
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

  const openProjectById = async (workspaceId: string, name?: string): Promise<void> => {
    const id = workspaceId.trim();
    if (!id) return;
    writeLastWorkspaceId(id);
    try {
      await vscode.commands.executeCommand(
        'zcode.fs.revealWorkspace',
        id,
        name || id,
      );
    } catch (err) {
      console.warn('[zcode-git] revealWorkspace failed', err);
      // Fallback: hard navigation so folderUri boots correctly
      try {
        const loc = globalThis.location;
        if (loc?.href) {
          const u = new URL(loc.href);
          u.searchParams.set('workspace', id);
          loc.assign(u.toString());
          return;
        }
      } catch {
        /* ignore */
      }
    }
    await refresh();
    projectsTree.refresh();
  };

  /**
   * Open Git Repository: paste HTTPS URL → clone into a **new** durable project → open it.
   * Progress notification starts immediately so a hung FS never looks like “clone is gone”.
   */
  const openRepository = async (prefillUrl?: string): Promise<void> => {
    if (openRepoBusy) {
      void vscode.window.showWarningMessage(
        'A clone is already in progress. If it is stuck, reload the window and try again.',
      );
      return;
    }

    const urlRaw =
      prefillUrl ??
      (await vscode.window.showInputBox({
        title: 'Open Git Repository',
        prompt:
          'Paste an HTTPS git URL — GitHub, GitLab, Bitbucket, Codeberg, or any HTTPS git host. Clones persist in this browser (OPFS / IndexedDB).',
        placeHolder: 'https://github.com/org/repo.git  ·  or  owner/repo',
        ignoreFocusOut: true,
        validateInput: validateGitUrl,
      }));
    if (urlRaw == null) return;

    const url = normalizeGitUrl(urlRaw);
    let auth = tokenAuth();

    // Let Quick Input dismiss fully before progress UI
    await new Promise<void>((r) => setTimeout(r, 50));

    openRepoBusy = true;
    // Safety: never leave the busy flag stuck for more than 15 minutes
    const busyTimer = setTimeout(() => {
      openRepoBusy = false;
    }, 15 * 60_000);

    try {
      const runClone = async (authForClone?: { username: string; password: string }) => {
        const shortName = shortNameFromUrl(url);

        const cloned = await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: `Cloning ${shortName}`,
            cancellable: false,
          },
          async (progress) => {
            progress.report({ message: 'preparing browser FS…' });

            try {
              await withTimeout(
                Promise.resolve(vscode.commands.executeCommand('zcode.fs.ready')),
                12_000,
                'zcode.fs.ready',
              );
            } catch (err) {
              console.warn('[zcode-git] zcode.fs.ready', err);
            }

            progress.report({ message: 'starting git agent…' });
            const a = await withTimeout(getAgent(), 15_000, 'git agent init');

            // Always allocate a dedicated workspace so projects don't overwrite each other
            const preferred = slugFromRepoName(shortName);
            const workspaceId = await allocateWorkspaceId(a, preferred);

            progress.report({ message: 'connecting via /git-proxy…' });
            const info = await a.clone({
              workspaceId,
              url,
              corsProxyUrl: proxyUrl(),
              depth: 1,
              auth: authForClone,
              onProgress: (p) => {
                progress.report({ message: formatCloneProgress(p) });
              },
            });

            progress.report({ message: 'opening project…' });
            return info;
          },
        );

        writeLastWorkspaceId(cloned.id);
        void vscode.window.showInformationMessage(
          `Cloned ${shortName} — project “${cloned.name}” (saved in this browser)`,
        );

        try {
          await vscode.commands.executeCommand(
            'zcode.fs.revealWorkspace',
            cloned.id,
            cloned.name || shortName,
          );
        } catch (err) {
          console.warn('[zcode-git] revealWorkspace failed', err);
        }
        try {
          await vscode.commands.executeCommand('zcode.fs.refreshExplorer');
        } catch {
          /* optional */
        }

        // Rename the Explorer folder label to the repo name when possible
        try {
          const folders = vscode.workspace.workspaceFolders ?? [];
          const idx = folders.findIndex(
            (f) =>
              f.uri.scheme === SCHEME &&
              (workspaceIdFromFolder(f.uri) ?? 'default') === cloned.id,
          );
          if (idx >= 0) {
            const folder = folders[idx]!;
            vscode.workspace.updateWorkspaceFolders(idx, 1, {
              uri: folder.uri,
              name: shortName,
            });
          }
        } catch {
          /* non-fatal */
        }

        projectsTree.refresh();
        void refresh();
      };

      try {
        await runClone(auth);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error('[zcode-git] clone failed', err);

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
          await new Promise<void>((r) => setTimeout(r, 50));
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
    } finally {
      clearTimeout(busyTimer);
      openRepoBusy = false;
    }
  };

  const manageProjects = async (): Promise<void> => {
    let a: ZCodeBrowserAgent;
    try {
      a = await withTimeout(getAgent(), 15_000, 'git agent init');
    } catch (err) {
      void vscode.window.showErrorMessage(
        `Browser FS not ready: ${err instanceof Error ? err.message : String(err)}`,
      );
      return;
    }

    const list = await a.listWorkspaces();
    const active = activeWorkspaceId();
    const withFlags = await Promise.all(
      list.map(async (w) => ({
        w,
        has: await workspaceHasContent(a, w.id),
      })),
    );

    type Pick = vscode.QuickPickItem & {
      action: 'open' | 'clone' | 'delete' | 'empty';
      workspaceId?: string;
    };

    const items: Pick[] = [
      {
        label: '$(repo-clone) Clone new repository…',
        description: 'HTTPS → durable browser project',
        action: 'clone',
      },
    ];

    const projects = withFlags
      .filter((e) => e.has || e.w.origin || e.w.id === active)
      .sort((a, b) => {
        if (a.w.id === active) return -1;
        if (b.w.id === active) return 1;
        return (b.w.createdAt || '').localeCompare(a.w.createdAt || '');
      });

    if (projects.length === 0) {
      items.push({
        label: '$(info) No saved projects yet',
        description: 'Clone a repo to create one (OPFS / IndexedDB)',
        action: 'empty',
      });
    } else {
      for (const { w, has } of projects) {
        const cur = w.id === active ? '$(check) ' : '';
        items.push({
          label: `${cur}$(repo) ${w.name}`,
          description: w.origin?.replace(/^https:\/\//, '') || w.id,
          detail: [
            has ? 'has files' : 'empty',
            w.id === active ? 'open' : undefined,
            `id ${w.id}`,
          ]
            .filter(Boolean)
            .join(' · '),
          action: 'open',
          workspaceId: w.id,
        });
      }
      items.push({
        label: '$(trash) Delete a project…',
        description: 'Remove from this browser only',
        action: 'delete',
      });
    }

    const pick = await vscode.window.showQuickPick(items, {
      title: 'Browser Projects',
      placeHolder: 'Switch project, clone, or delete (data stays in this browser)',
      matchOnDescription: true,
      matchOnDetail: true,
      ignoreFocusOut: true,
    });
    if (!pick) return;

    if (pick.action === 'clone' || pick.action === 'empty') {
      await openRepository();
      return;
    }

    if (pick.action === 'open' && pick.workspaceId) {
      const meta = list.find((w) => w.id === pick.workspaceId);
      await openProjectById(pick.workspaceId, meta?.name);
      return;
    }

    if (pick.action === 'delete') {
      const delItems = projects
        .filter((p) => p.w.id !== 'default' || projects.length === 1)
        .map((p) => ({
          label: p.w.name,
          description: p.w.id,
          workspaceId: p.w.id,
        }));
      const del = await vscode.window.showQuickPick(delItems, {
        title: 'Delete browser project',
        placeHolder: 'This removes files from OPFS/IndexedDB in this browser only',
      });
      if (!del) return;
      const confirm = await vscode.window.showWarningMessage(
        `Delete project “${del.label}” from this browser? This cannot be undone.`,
        { modal: true },
        'Delete',
      );
      if (confirm !== 'Delete') return;
      try {
        await a.deleteWorkspace(del.workspaceId);
        if (activeWorkspaceId() === del.workspaceId) {
          // Switch to another project or empty default
          const remaining = (await a.listWorkspaces()).filter((w) => w.id !== del.workspaceId);
          const next = remaining.find((w) => w.id !== 'default') ?? remaining[0];
          if (next) {
            await openProjectById(next.id, next.name);
          } else {
            await openProjectById('default', 'default');
          }
        }
        void vscode.window.showInformationMessage(`Deleted project “${del.label}”`);
        projectsTree.refresh();
        void refresh();
      } catch (err) {
        void vscode.window.showErrorMessage(
          `Delete failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  };

  /**
   * First paint: restore last project if needed, else prompt to clone.
   * Runs once after agent + FS are ready.
   */
  const runStartupFlow = async (): Promise<void> => {
    try {
      const a = await withTimeout(getAgent(), 20_000, 'git agent init');
      await vscode.commands.executeCommand('zcode.fs.ready').then(
        () => undefined,
        () => undefined,
      );

      const list = await a.listWorkspaces();
      const active = activeWorkspaceId() || 'default';
      const activeHas = await workspaceHasContent(a, active).catch(() => false);

      const withContent: WorkspaceInfo[] = [];
      for (const w of list) {
        if (await workspaceHasContent(a, w.id).catch(() => false)) {
          withContent.push(w);
        } else if (w.origin) {
          withContent.push(w);
        }
      }

      // Restore last project when current folder is empty but we have saved work
      const last = readLastWorkspaceId();
      if (!activeHas && last && last !== active) {
        const lastMeta = list.find((w) => w.id === last);
        if (lastMeta && (await workspaceHasContent(a, last).catch(() => false))) {
          console.info(`[zcode-git] restoring last workspace ${last}`);
          await openProjectById(last, lastMeta.name);
          return;
        }
      }

      // Prefer any saved project over empty default
      if (!activeHas && withContent.length > 0) {
        const prefer =
          (last && withContent.find((w) => w.id === last)) ||
          withContent.find((w) => w.id !== 'default') ||
          withContent[0]!;
        if (prefer.id !== active) {
          console.info(`[zcode-git] opening existing project ${prefer.id}`);
          await openProjectById(prefer.id, prefer.name);
          return;
        }
        // Already on a project with content
        writeLastWorkspaceId(active);
        return;
      }

      if (activeHas) {
        writeLastWorkspaceId(active);
        return;
      }

      // Truly empty install — prompt to clone (unless user dismissed this session)
      let skip = false;
      try {
        skip = globalThis.sessionStorage?.getItem(SKIP_WELCOME_KEY) === '1';
      } catch {
        /* ignore */
      }
      if (skip) return;

      const choice = await vscode.window.showInformationMessage(
        'Welcome to ZCode. Clone a git repository into this browser (files persist in OPFS / IndexedDB).',
        'Open Repository…',
        'Browse Projects…',
        'Not now',
      );
      if (choice === 'Open Repository…') {
        await openRepository();
      } else if (choice === 'Browse Projects…') {
        await manageProjects();
      } else if (choice === 'Not now') {
        try {
          globalThis.sessionStorage?.setItem(SKIP_WELCOME_KEY, '1');
        } catch {
          /* ignore */
        }
      }
    } catch (err) {
      console.warn('[zcode-git] startup flow', err);
    }
  };

  context.subscriptions.push(
    vscode.commands.registerCommand('zcode.git.refresh', () => refresh()),
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
        const a = await getAgent();
        const { oid } = await a.commit({
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
        const a = await getAgent();
        await a.push({
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
    // Return promise so command stays active until clone finishes
    vscode.commands.registerCommand('zcode.git.openRepository', () => openRepository()),
    vscode.commands.registerCommand('zcode.git.clone', () => openRepository()),
    // Welcome "Open Repository..." → ZCode clone (not Microsoft Remote Hub)
    vscode.commands.registerCommand('remoteHub.openRepository', () => openRepository()),
    vscode.commands.registerCommand('zcode.git.manageProjects', () => manageProjects()),
    vscode.commands.registerCommand(
      'zcode.git.openProject',
      (workspaceId?: string | ProjectItem) => {
        if (workspaceId && typeof workspaceId === 'object' && 'workspace' in workspaceId) {
          return openProjectById(workspaceId.workspace.id, workspaceId.workspace.name);
        }
        if (typeof workspaceId === 'string' && workspaceId) {
          return openProjectById(workspaceId);
        }
        return manageProjects();
      },
    ),
    vscode.commands.registerCommand(
      'zcode.git.deleteProject',
      async (item?: ProjectItem | string) => {
        const id =
          typeof item === 'string'
            ? item
            : item?.workspace?.id ??
              (
                await vscode.window.showInputBox({
                  title: 'Delete browser project',
                  prompt: 'Workspace id',
                })
              )?.trim();
        if (!id) return;
        const a = await getAgent();
        const list = await a.listWorkspaces();
        const meta = list.find((w) => w.id === id);
        const confirm = await vscode.window.showWarningMessage(
          `Delete project “${meta?.name ?? id}” from this browser?`,
          { modal: true },
          'Delete',
        );
        if (confirm !== 'Delete') return;
        await a.deleteWorkspace(id);
        if (activeWorkspaceId() === id) {
          const remaining = (await a.listWorkspaces()).filter((w) => w.id !== id);
          const next = remaining[0];
          if (next) await openProjectById(next.id, next.name);
          else await openProjectById('default', 'default');
        }
        projectsTree.refresh();
        void refresh();
      },
    ),
    vscode.commands.registerCommand('zcode.git.refreshProjects', () => {
      projectsTree.refresh();
      return refresh();
    }),
  );

  context.subscriptions.push(
    vscode.workspace.onDidSaveTextDocument((doc) => {
      if (doc.uri.scheme === SCHEME) void refresh();
    }),
    vscode.workspace.onDidChangeWorkspaceFolders(() => {
      const id = activeWorkspaceId();
      if (id) writeLastWorkspaceId(id);
      void refresh();
      projectsTree.refresh();
    }),
  );

  void refresh();
  const timer = setInterval(() => void refresh(), 8_000);
  context.subscriptions.push({ dispose: () => clearInterval(timer) });

  // Delay slightly so Explorer / FS provider settle first
  void (async () => {
    await new Promise((r) => setTimeout(r, 800));
    await runStartupFlow();
  })();
}

export function deactivate(): void {
  /* no-op */
}
