import git from 'isomorphic-git';
import http from 'isomorphic-git/http/web';
import type {
  CloneOpts,
  CloneProgress,
  CommitOpts,
  GitAuth,
  PushOpts,
  WorkspaceInfo,
} from '@zcode/protocol';
import type { AgentFs } from './memory-fs.js';
import { createIsoFs } from './iso-fs.js';
import type { WorkspaceStore } from './workspace-store.js';

/** isomorphic-git onAuth for HTTPS PAT / password. */
function makeOnAuth(auth?: GitAuth) {
  if (!auth?.password) return undefined;
  return () => ({
    username: auth.username?.trim() || 'git',
    password: auth.password,
  });
}

export async function gitClone(
  fs: AgentFs,
  store: WorkspaceStore,
  opts: CloneOpts,
): Promise<WorkspaceInfo> {
  const nameFromUrl =
    opts.url.replace(/\/$/, '').split('/').pop()?.replace(/\.git$/, '') ?? opts.workspaceId;

  let rec = store.get(opts.workspaceId);
  if (!rec) {
    rec = store.create(nameFromUrl, opts.workspaceId);
    await fs.mkdir(rec.rootKey);
  } else {
    store.rename(rec.id, nameFromUrl);
  }

  const iso = createIsoFs(fs, rec.rootKey);
  const proxy = opts.corsProxyUrl.replace(/\/$/, '');

  let lastEmit = 0;
  const emit = (p: CloneProgress) => {
    // Throttle UI callbacks slightly but always emit terminal phases
    const now = Date.now();
    if (p.phase === 'done' || p.phase === 'negotiating' || now - lastEmit >= 80) {
      lastEmit = now;
      opts.onProgress?.(p);
    }
  };

  emit({ phase: 'negotiating', message: 'starting clone' });

  const onAuth = makeOnAuth(opts.auth);
  try {
    await git.clone({
      fs: iso,
      http,
      dir: '.',
      url: opts.url,
      corsProxy: proxy,
      ref: opts.ref,
      singleBranch: true,
      depth: opts.depth ?? 1,
      ...(onAuth ? { onAuth } : {}),
      onProgress: (e) => {
        const phase = mapPhase(e.phase);
        emit({
          phase,
          receivedObjects: typeof e.loaded === 'number' ? e.loaded : undefined,
          totalObjects: typeof e.total === 'number' && e.total > 0 ? e.total : undefined,
          message: e.phase,
        });
      },
      onMessage: (msg) => {
        emit({ phase: 'negotiating', message: String(msg).trim() });
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (/401|403|auth|credential|Authentication/i.test(message)) {
      throw Object.assign(
        new Error(
          `${message} — private repo? set a GitHub/GitLab personal access token in App config`,
        ),
        { code: 'GIT_ERROR', cause: err },
      );
    }
    // Common failure: proxy down / CORS / SSRF block
    if (/Failed to fetch|NetworkError|CORS|502|504/i.test(message)) {
      throw Object.assign(
        new Error(
          `${message} — check git-proxy at ${proxy} (same-origin /git-proxy via zcode web)`,
        ),
        { code: 'PROXY_REQUIRED', cause: err },
      );
    }
    throw Object.assign(new Error(message), { code: 'GIT_ERROR', cause: err });
  }

  emit({ phase: 'done', message: 'clone complete' });

  // Persist meta so IDE / new tabs can hydrate the same IDB workspace
  try {
    await fs.writeFile(
      `${rec.rootKey}/.zcode-workspace.json`,
      JSON.stringify({
        id: rec.id,
        name: rec.name,
        createdAt: rec.createdAt,
        origin: opts.url,
      }),
    );
  } catch {
    /* non-fatal */
  }

  await refreshBytes(fs, store, rec.id, rec.rootKey);

  const fresh = store.get(rec.id)!;
  return {
    id: fresh.id,
    name: fresh.name,
    uri: fresh.uri,
    createdAt: fresh.createdAt,
    approxBytes: fresh.approxBytes,
  };
}

function mapPhase(phase: string | undefined): CloneProgress['phase'] {
  const p = (phase ?? '').toLowerCase();
  if (p.includes('receiv') || p.includes('object')) return 'receiving';
  if (p.includes('resolv') || p.includes('delta') || p.includes('check')) return 'resolving';
  if (p.includes('done') || p.includes('complete')) return 'done';
  return 'negotiating';
}

export async function gitCommit(
  fs: AgentFs,
  store: WorkspaceStore,
  opts: CommitOpts,
): Promise<{ oid: string }> {
  const rec = requireWorkspace(store, opts.workspaceId);
  const iso = createIsoFs(fs, rec.rootKey);

  const status = await git.statusMatrix({ fs: iso, dir: '.' });
  for (const [filepath, , workdir, stage] of status) {
    if (workdir === 0) {
      if (stage !== 0) await git.remove({ fs: iso, dir: '.', filepath });
    } else if (workdir !== stage) {
      await git.add({ fs: iso, dir: '.', filepath });
    }
  }

  const oid = await git.commit({
    fs: iso,
    dir: '.',
    message: opts.message,
    author: {
      name: opts.author?.name ?? 'ZCode',
      email: opts.author?.email ?? 'zcode@localhost',
    },
  });
  return { oid };
}

export async function gitPush(
  fs: AgentFs,
  store: WorkspaceStore,
  opts: PushOpts,
): Promise<void> {
  const rec = requireWorkspace(store, opts.workspaceId);
  const iso = createIsoFs(fs, rec.rootKey);
  const onAuth = makeOnAuth(opts.auth);
  try {
    await git.push({
      fs: iso,
      http,
      dir: '.',
      remote: opts.remote ?? 'origin',
      corsProxy: opts.corsProxyUrl.replace(/\/$/, ''),
      force: opts.force,
      ...(onAuth ? { onAuth } : {}),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (/401|403|auth|credential|Authentication|denied/i.test(message)) {
      throw Object.assign(
        new Error(
          `${message} — push needs a token with write access (GitHub: repo scope / fine-grained contents:write)`,
        ),
        { code: 'GIT_ERROR', cause: err },
      );
    }
    throw Object.assign(new Error(message), { code: 'GIT_ERROR', cause: err });
  }
}

export type GitChangeKind = 'modified' | 'added' | 'deleted' | 'untracked';

export interface GitChange {
  path: string;
  kind: GitChangeKind;
}

/**
 * Map isomorphic-git statusMatrix row → change kind.
 * Matrix: [filepath, HEAD, WORKDIR, STAGE] where 0=absent, 1=same/present, 2=different.
 */
export function changeKindFromMatrix(
  head: number,
  workdir: number,
  stage: number,
): GitChangeKind | null {
  // Clean
  if (head === 1 && workdir === 1 && stage === 1) return null;
  // Untracked
  if (head === 0 && workdir === 2 && stage === 0) return 'untracked';
  // Deleted (in workdir)
  if (head === 1 && workdir === 0) return 'deleted';
  // Added (new file staged or present, not in HEAD)
  if (head === 0 && (workdir === 2 || stage === 2 || stage === 3)) return 'added';
  // Modified
  if (head === 1 && (workdir === 2 || stage === 2 || stage === 3)) return 'modified';
  // Staged-only variants
  if (head === 0 && stage !== 0) return 'added';
  if (head === 1 && stage === 0) return 'deleted';
  return 'modified';
}

export async function gitListChanges(
  fs: AgentFs,
  store: WorkspaceStore,
  workspaceId: string,
): Promise<GitChange[]> {
  const rec = requireWorkspace(store, workspaceId);
  const iso = createIsoFs(fs, rec.rootKey);
  try {
    const matrix = await git.statusMatrix({ fs: iso, dir: '.' });
    const out: GitChange[] = [];
    for (const [filepath, head, workdir, stage] of matrix) {
      if (filepath === '.' || filepath.startsWith('.git/')) continue;
      const kind = changeKindFromMatrix(head, workdir, stage);
      if (kind) out.push({ path: filepath, kind });
    }
    return out.sort((a, b) => a.path.localeCompare(b.path));
  } catch {
    return [];
  }
}

export async function gitStatus(
  fs: AgentFs,
  store: WorkspaceStore,
  workspaceId: string,
): Promise<{ branch: string; dirty: boolean; ahead: number; behind: number }> {
  const rec = requireWorkspace(store, workspaceId);
  const iso = createIsoFs(fs, rec.rootKey);
  let branch = 'main';
  try {
    branch = (await git.currentBranch({ fs: iso, dir: '.', fullname: false })) ?? 'main';
  } catch {
    /* empty */
  }
  let dirty = false;
  try {
    const changes = await gitListChanges(fs, store, workspaceId);
    dirty = changes.length > 0;
  } catch {
    dirty = false;
  }
  return { branch, dirty, ahead: 0, behind: 0 };
}

export async function listWorkspaceFiles(
  fs: AgentFs,
  store: WorkspaceStore,
  workspaceId: string,
): Promise<string[]> {
  const rec = requireWorkspace(store, workspaceId);
  if (!fs.listFiles) return [];
  const all = await fs.listFiles(rec.rootKey);
  const prefix = rec.rootKey + '/';
  return all
    .filter((f) => f.startsWith(prefix) && !f.includes('/.git/'))
    .map((f) => f.slice(prefix.length));
}

export async function readWorkspaceFile(
  fs: AgentFs,
  store: WorkspaceStore,
  workspaceId: string,
  relPath: string,
): Promise<string> {
  const rec = requireWorkspace(store, workspaceId);
  const data = await fs.readFile(`${rec.rootKey}/${relPath}`);
  return new TextDecoder().decode(data);
}

export async function writeWorkspaceFile(
  fs: AgentFs,
  store: WorkspaceStore,
  workspaceId: string,
  relPath: string,
  content: string,
): Promise<void> {
  const rec = requireWorkspace(store, workspaceId);
  await fs.writeFile(`${rec.rootKey}/${relPath}`, content);
}

function requireWorkspace(store: WorkspaceStore, id: string) {
  const rec = store.get(id);
  if (!rec) {
    throw Object.assign(new Error(`workspace not found: ${id}`), { code: 'NOT_FOUND' });
  }
  return rec;
}

async function refreshBytes(
  fs: AgentFs,
  store: WorkspaceStore,
  id: string,
  rootKey: string,
): Promise<void> {
  if (!fs.listFiles) return;
  const files = await fs.listFiles(rootKey);
  let bytes = 0;
  for (const f of files) {
    if (f.includes('/.git/')) continue;
    try {
      bytes += (await fs.readFile(f)).byteLength;
    } catch {
      /* ignore */
    }
  }
  store.updateBytes(id, bytes);
}
