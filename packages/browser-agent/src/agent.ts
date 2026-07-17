import type {
  BrowserAgent,
  CloneOpts,
  CommitOpts,
  PushOpts,
  WorkspaceInfo,
} from '@zcode/protocol';
import { WorkspaceLock } from './lock.js';
import type { AgentFs } from './memory-fs.js';
import { MemoryFs } from './memory-fs.js';
import { WorkspaceStore } from './workspace-store.js';
import {
  gitClone,
  gitCommit,
  gitPush,
  gitStatus,
  listWorkspaceFiles,
  readWorkspaceFile,
  writeWorkspaceFile,
} from './git.js';

export interface BrowserAgentOptions {
  fs?: AgentFs;
  store?: WorkspaceStore;
  lock?: WorkspaceLock;
}

/**
 * Browser agent: workspace CRUD, lock, isomorphic-git clone/commit/push.
 */
export class ZCodeBrowserAgent implements BrowserAgent {
  readonly fs: AgentFs;
  readonly store: WorkspaceStore;
  readonly lock: WorkspaceLock;

  constructor(opts: BrowserAgentOptions = {}) {
    this.fs = opts.fs ?? new MemoryFs();
    this.store = opts.store ?? new WorkspaceStore();
    this.lock = opts.lock ?? new WorkspaceLock();
  }

  async createWorkspace(name: string): Promise<WorkspaceInfo> {
    const rec = this.store.create(name);
    await this.fs.mkdir(rec.rootKey);
    await this.fs.writeFile(
      `${rec.rootKey}/.zcode-workspace.json`,
      JSON.stringify({
        id: rec.id,
        name: rec.name,
        createdAt: rec.createdAt,
      }),
    );
    return {
      id: rec.id,
      name: rec.name,
      uri: rec.uri,
      createdAt: rec.createdAt,
      approxBytes: rec.approxBytes,
    };
  }

  async listWorkspaces(): Promise<WorkspaceInfo[]> {
    return this.store.list();
  }

  async deleteWorkspace(id: string): Promise<void> {
    await this.withWorkspaceLock(id, async () => {
      const rec = this.store.get(id);
      if (!rec) {
        throw Object.assign(new Error(`workspace not found: ${id}`), { code: 'NOT_FOUND' });
      }
      await this.fs.rm(rec.rootKey, { recursive: true });
      this.store.delete(id);
    });
  }

  async storageEstimate(): Promise<{ usage: number; quota: number }> {
    return this.fs.estimate();
  }

  async clone(opts: CloneOpts): Promise<WorkspaceInfo> {
    return this.withWorkspaceLock(opts.workspaceId, () =>
      gitClone(this.fs, this.store, opts),
    );
  }

  async commit(opts: CommitOpts): Promise<{ oid: string }> {
    return this.withWorkspaceLock(opts.workspaceId, () =>
      gitCommit(this.fs, this.store, opts),
    );
  }

  async push(opts: PushOpts): Promise<void> {
    return this.withWorkspaceLock(opts.workspaceId, () => gitPush(this.fs, this.store, opts));
  }

  async status(workspaceId: string): Promise<{
    branch: string;
    dirty: boolean;
    ahead: number;
    behind: number;
  }> {
    return gitStatus(this.fs, this.store, workspaceId);
  }

  async listFiles(workspaceId: string): Promise<string[]> {
    return listWorkspaceFiles(this.fs, this.store, workspaceId);
  }

  async readFile(workspaceId: string, path: string): Promise<string> {
    return readWorkspaceFile(this.fs, this.store, workspaceId, path);
  }

  async writeFile(workspaceId: string, path: string, content: string): Promise<void> {
    return this.withWorkspaceLock(workspaceId, () =>
      writeWorkspaceFile(this.fs, this.store, workspaceId, path, content),
    );
  }

  async withWorkspaceLock<T>(workspaceId: string, fn: () => Promise<T>): Promise<T> {
    return this.lock.withLock(workspaceId, fn);
  }
}

export function createBrowserAgent(opts?: BrowserAgentOptions): BrowserAgent & ZCodeBrowserAgent {
  return new ZCodeBrowserAgent(opts);
}
