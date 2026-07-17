import git from 'isomorphic-git';
import http from 'isomorphic-git/http/web';
import type { CloneOpts, CommitOpts, PushOpts, WorkspaceInfo } from '@zcode/protocol';
import type { AgentFs } from './memory-fs.js';
import { createIsoFs } from './iso-fs.js';
import type { WorkspaceStore } from './workspace-store.js';

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

  await git.clone({
    fs: iso,
    http,
    dir: '.',
    url: opts.url,
    corsProxy: opts.corsProxyUrl.replace(/\/$/, ''),
    ref: opts.ref,
    singleBranch: true,
    depth: opts.depth ?? 1,
    onProgress: (e) => {
      opts.onProgress?.({
        phase:
          e.phase === 'Receiving objects'
            ? 'receiving'
            : e.phase === 'Resolving deltas'
              ? 'resolving'
              : 'negotiating',
        receivedObjects: e.loaded,
        totalObjects: e.total,
        message: e.phase,
      });
    },
  });

  opts.onProgress?.({ phase: 'done' });
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
  await git.push({
    fs: iso,
    http,
    dir: '.',
    remote: opts.remote ?? 'origin',
    corsProxy: opts.corsProxyUrl.replace(/\/$/, ''),
    force: opts.force,
  });
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
    const matrix = await git.statusMatrix({ fs: iso, dir: '.' });
    dirty = matrix.some(([, head, workdir, stage]) => head !== workdir || workdir !== stage);
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
