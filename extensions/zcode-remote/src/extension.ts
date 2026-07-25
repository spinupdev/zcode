/**
 * Same-origin remote connect / disconnect (RA1 + RA2 Tier 1 + WS1).
 *
 * Tier 1: flush dirty → export OPFS files-v1 → POST /v1/workspace/import → reload mode=remote.
 * No secrets in URLs (KD12).
 */
import * as vscode from 'vscode';
import { collectWorkspaceFilesV1 } from './export-workspace.js';
import {
  applyFilesV1ToFolder,
  browserWorkspaceUri,
  downloadRemoteExport,
} from './import-workspace.js';

const CONTINUITY_KEY = 'zcode.remote.continuity';

interface SessionResponse {
  authenticated?: boolean;
  ready?: boolean;
  authority?: string;
  /** legacy string mode or object */
  reh?: string | { mode?: string; available?: boolean };
  rehInfo?: { mode?: string; available?: boolean };
  rehProxy?: boolean;
  workspacePath?: string;
  workspaceImport?: boolean;
  error?: string;
}

interface ContinuityState {
  workspaceId?: string;
  openUris: string[];
  savedAt: number;
  fromMode: 'browser' | 'remote';
  importedFiles?: number;
}

function productMode(): 'browser' | 'remote' {
  const product = (globalThis as { product?: Record<string, unknown> }).product ?? {};
  const mode =
    (product.zcodeMode as string | undefined) ??
    ((product.productConfiguration as { zcodeMode?: string } | undefined)?.zcodeMode);
  if (mode === 'remote' || product.remoteAuthority) return 'remote';
  return 'browser';
}

function rehAvailable(session: SessionResponse | null): boolean {
  if (!session) return false;
  if (session.rehProxy) return true;
  if (session.rehInfo?.available) return true;
  if (session.reh && typeof session.reh === 'object' && session.reh.available) return true;
  if (typeof session.reh === 'string' && session.reh !== 'none') return true;
  return false;
}

async function fetchSession(): Promise<SessionResponse | null> {
  try {
    const res = await fetch('/v1/session', { cache: 'no-store', credentials: 'same-origin' });
    if (res.status === 404) return null;
    if (!res.ok) return { authenticated: false, error: `HTTP ${res.status}` };
    return (await res.json()) as SessionResponse;
  } catch {
    return null;
  }
}

function cleanRemoteUrl(authority: string): string {
  const u = new URL(location.href);
  for (const key of ['tkn', 'token', 'connectionToken', 'cc', 'connectCode', 'password']) {
    u.searchParams.delete(key);
  }
  u.searchParams.set('mode', 'remote');
  u.searchParams.set('ready', '1');
  u.searchParams.set('authority', authority);
  return u.pathname + u.search + u.hash;
}

function cleanBrowserUrl(): string {
  const u = new URL(location.href);
  for (const key of ['tkn', 'token', 'connectionToken', 'cc', 'connectCode', 'password', 'ready']) {
    u.searchParams.delete(key);
  }
  u.searchParams.set('mode', 'browser');
  u.searchParams.delete('authority');
  u.searchParams.delete('remoteAuthority');
  return u.pathname + u.search + u.hash;
}

async function saveAllDirty(): Promise<boolean> {
  const dirty = vscode.workspace.textDocuments.filter((d) => d.isDirty && !d.isUntitled);
  if (dirty.length === 0) return true;
  const ok = await vscode.workspace.saveAll(false);
  if (!ok) {
    const pick = await vscode.window.showWarningMessage(
      'Some editors could not be saved. Continue attach anyway?',
      'Continue',
      'Cancel',
    );
    return pick === 'Continue';
  }
  return true;
}

function captureContinuity(
  context: vscode.ExtensionContext,
  fromMode: 'browser' | 'remote',
  extra?: Partial<ContinuityState>,
): void {
  const openUris = vscode.window.tabGroups.all
    .flatMap((g) => g.tabs)
    .map((t) => {
      const input = t.input as { uri?: vscode.Uri } | undefined;
      return input?.uri?.toString();
    })
    .filter((x): x is string => !!x);

  const folders = vscode.workspace.workspaceFolders ?? [];
  const workspaceId =
    folders
      .find((f) => f.uri.scheme === 'zcode-opfs')
      ?.uri.path.replace(/^\/workspace\//, '')
      .split('/')[0] ??
    new URL(location.href).searchParams.get('workspace') ??
    'default';

  const state: ContinuityState = {
    workspaceId,
    openUris: openUris.slice(0, 40),
    savedAt: Date.now(),
    fromMode,
    ...extra,
  };
  void context.globalState.update(CONTINUITY_KEY, state);
  try {
    sessionStorage.setItem(CONTINUITY_KEY, JSON.stringify(state));
  } catch {
    /* private mode */
  }
}

async function restoreContinuityHint(context: vscode.ExtensionContext): Promise<void> {
  let state = context.globalState.get<ContinuityState>(CONTINUITY_KEY);
  if (!state) {
    try {
      const raw = sessionStorage.getItem(CONTINUITY_KEY);
      if (raw) state = JSON.parse(raw) as ContinuityState;
    } catch {
      /* ignore */
    }
  }
  if (!state || Date.now() - state.savedAt > 30 * 60 * 1000) return;

  if (state.importedFiles && productMode() === 'remote') {
    void vscode.window.showInformationMessage(
      `Remote workspace ready (${state.importedFiles} file(s) imported from browser).`,
    );
  }

  for (const uriStr of state.openUris.slice(0, 12)) {
    try {
      const uri = vscode.Uri.parse(uriStr);
      if (uri.scheme === 'zcode-opfs' && productMode() === 'remote') continue;
      if (uri.scheme === 'vscode-remote' && productMode() === 'browser') continue;
      await vscode.commands.executeCommand('vscode.open', uri);
    } catch {
      /* skip missing */
    }
  }
  void context.globalState.update(CONTINUITY_KEY, undefined);
  try {
    sessionStorage.removeItem(CONTINUITY_KEY);
  } catch {
    /* ignore */
  }
}

async function uploadWorkspace(): Promise<{ fileCount: number } | null> {
  const payload = await collectWorkspaceFilesV1();
  if (!payload) return null;

  const res = await fetch('/v1/workspace/import', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(err.error ?? `import failed HTTP ${res.status}`);
  }
  const body = (await res.json()) as { fileCount?: number };
  return { fileCount: body.fileCount ?? Object.keys(payload.files).length };
}

let statusItem: vscode.StatusBarItem | undefined;

function updateStatusBar(mode: 'browser' | 'remote', session: SessionResponse | null): void {
  if (!statusItem) return;
  if (mode === 'remote') {
    statusItem.text = '$(cloud) Remote';
    statusItem.tooltip = `Remote mode · ${session?.authority ?? location.host}`;
  } else if (rehAvailable(session)) {
    statusItem.text = '$(cloud-offline) Browser · REH available';
    statusItem.tooltip = 'Click to connect to remote (same-origin)';
  } else if (session === null) {
    statusItem.text = '$(folder) Browser';
    statusItem.tooltip = 'Browser mode (no /v1/session — static host)';
  } else {
    statusItem.text = '$(folder) Browser';
    statusItem.tooltip = 'Browser mode · remote not available';
  }
}

export function activate(context: vscode.ExtensionContext): void {
  statusItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 49);
  statusItem.command = 'zcode.remote.status';
  statusItem.show();

  const refresh = async () => {
    const mode = productMode();
    const session = await fetchSession();
    updateStatusBar(mode, session);
  };
  void refresh();
  void restoreContinuityHint(context);

  context.subscriptions.push(
    statusItem,
    vscode.commands.registerCommand('zcode.remote.connect', () => connect(context)),
    vscode.commands.registerCommand('zcode.remote.upgrade', () => connect(context)),
    vscode.commands.registerCommand('zcode.remote.disconnect', () => disconnect(context)),
    vscode.commands.registerCommand('zcode.remote.status', () => showStatus()),
  );
}

export function deactivate(): void {
  /* status disposed via context */
}

async function connect(context: vscode.ExtensionContext): Promise<void> {
  if (productMode() === 'remote') {
    void vscode.window.showInformationMessage('Already in remote mode.');
    return;
  }

  const session = await fetchSession();
  if (session === null) {
    void vscode.window.showErrorMessage(
      'Remote session API not available on this host (static browser-only). Run `zcode serve` with REH for remote attach.',
    );
    return;
  }

  if (!session.authenticated && !session.ready) {
    const redirect = encodeURIComponent(location.pathname + location.search);
    const go = await vscode.window.showInformationMessage(
      'Sign in required to attach to remote.',
      'Open Login',
      'Cancel',
    );
    if (go === 'Open Login') {
      location.assign(`/login?redirect=${redirect}`);
    }
    return;
  }

  if (!rehAvailable(session)) {
    void vscode.window.showWarningMessage(
      'REH is not running on this server. Connect will open remote mode but terminal may be unavailable until dist/server is present.',
    );
  }

  const confirm = await vscode.window.showInformationMessage(
    'Connect to remote? Editors will be saved, browser workspace files uploaded, then the workbench reloads in remote mode.',
    { modal: true },
    'Connect',
    'Cancel',
  );
  if (confirm !== 'Connect') return;

  const saved = await saveAllDirty();
  if (!saved) return;

  let importedFiles = 0;
  let aborted = false;
  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: 'ZCode: preparing remote…',
      cancellable: false,
    },
    async (progress) => {
      progress.report({ message: 'Uploading workspace…' });
      try {
        const up = await uploadWorkspace();
        importedFiles = up?.fileCount ?? 0;
        if (up) {
          progress.report({ message: `Imported ${up.fileCount} file(s)` });
        } else {
          progress.report({ message: 'No files to import (empty workspace)' });
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        const cont = await vscode.window.showWarningMessage(
          `Workspace upload failed: ${msg}. Continue to remote without files?`,
          'Continue',
          'Cancel',
        );
        if (cont !== 'Continue') {
          aborted = true;
        }
      }
    },
  );
  if (aborted) return;

  captureContinuity(context, 'browser', { importedFiles });

  const authority = session.authority || location.host;
  location.assign(cleanRemoteUrl(authority));
}

async function disconnect(context: vscode.ExtensionContext): Promise<void> {
  if (productMode() === 'browser') {
    void vscode.window.showInformationMessage('Already in browser mode.');
    return;
  }

  const confirm = await vscode.window.showInformationMessage(
    'Disconnect remote and return to browser mode? Remote files will be pulled into the browser workspace (best-effort), then the workbench reloads.',
    { modal: true },
    'Disconnect',
    'Cancel',
  );
  if (confirm !== 'Disconnect') return;

  await saveAllDirty();

  let pulled = 0;
  let aborted = false;
  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: 'ZCode: disconnecting…',
      cancellable: false,
    },
    async (progress) => {
      progress.report({ message: 'Pulling remote workspace into browser storage…' });
      try {
        const payload = await downloadRemoteExport();
        if (payload) {
          const workspaceId =
            payload.workspaceId ||
            new URL(location.href).searchParams.get('workspace') ||
            'default';
          const folder = browserWorkspaceUri(workspaceId);
          // Ensure OPFS provider can write even when remote folder is open
          try {
            await vscode.workspace.fs.createDirectory(folder);
          } catch {
            /* exists */
          }
          const result = await applyFilesV1ToFolder(folder, payload);
          pulled = result.fileCount;
          // Remember id so browser reload opens same OPFS workspace
          void context.globalState.update(CONTINUITY_KEY, {
            workspaceId,
            openUris: [],
            savedAt: Date.now(),
            fromMode: 'remote' as const,
            importedFiles: pulled,
          });
          try {
            sessionStorage.setItem(
              CONTINUITY_KEY,
              JSON.stringify({
                workspaceId,
                openUris: [],
                savedAt: Date.now(),
                fromMode: 'remote',
                importedFiles: pulled,
              }),
            );
          } catch {
            /* ignore */
          }
          progress.report({ message: `Pulled ${pulled} file(s)` });
        } else {
          progress.report({ message: 'Nothing to pull (empty or unavailable)' });
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        const cont = await vscode.window.showWarningMessage(
          `Could not pull remote files: ${msg}. Disconnect anyway?`,
          'Disconnect',
          'Cancel',
        );
        if (cont !== 'Disconnect') {
          aborted = true;
        }
      }
    },
  );
  if (aborted) return;

  captureContinuity(context, 'remote', { importedFiles: pulled });
  // Prefer workspace id in URL so browser mode reopens same OPFS id
  const u = new URL(location.origin + cleanBrowserUrl());
  const cont = context.globalState.get<ContinuityState>(CONTINUITY_KEY);
  if (cont?.workspaceId) {
    u.searchParams.set('workspace', cont.workspaceId);
  }
  location.assign(u.pathname + u.search + u.hash);
}

async function showStatus(): Promise<void> {
  const mode = productMode();
  const session = await fetchSession();
  const lines = [
    `# ZCode remote status`,
    ``,
    `- workbench mode: **${mode}**`,
    `- host: \`${location.host}\``,
    `- session API: ${session === null ? 'unavailable' : 'ok'}`,
    `- authenticated: ${session?.authenticated ?? false}`,
    `- ready: ${session?.ready ?? false}`,
    `- authority: ${session?.authority ?? '—'}`,
    `- reh: ${JSON.stringify(session?.reh ?? null)}`,
    `- rehInfo: ${JSON.stringify(session?.rehInfo ?? null)}`,
    `- rehProxy: ${session?.rehProxy ?? false}`,
    `- workspaceImport: ${session?.workspaceImport ?? false}`,
    `- workspacePath: ${session?.workspacePath ?? '—'}`,
    ``,
    `Commands: **Connect to Remote** · **Disconnect Remote**`,
    ``,
    `Topology: same-origin only (ADR 0001). Workspace sync: files-v1 (ADR 0002).`,
  ];
  const doc = await vscode.workspace.openTextDocument({
    content: lines.join('\n'),
    language: 'markdown',
  });
  await vscode.window.showTextDocument(doc, { preview: true });
  updateStatusBar(mode, session);
}
