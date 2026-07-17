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

export interface BrowserAgentOptions {
  fs?: AgentFs;
  store?: WorkspaceStore;
  lock?: WorkspaceLock;
}

/**
 * Browser agent core: workspace CRUD + lock.
 * Git clone/commit/push land in Track B4 (isomorphic-git + proxy).
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
    await this.fs.writeFile(`${rec.rootKey}/.zcode-workspace.json`, JSON.stringify({
      id: rec.id,
      name: rec.name,
      createdAt: rec.createdAt,
    }));
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

  async clone(_opts: CloneOpts): Promise<WorkspaceInfo> {
    throw Object.assign(new Error('clone not implemented yet (Track B4)'), {
      code: 'INTERNAL',
    });
  }

  async commit(_opts: CommitOpts): Promise<{ oid: string }> {
    throw Object.assign(new Error('commit not implemented yet (Track B4)'), {
      code: 'INTERNAL',
    });
  }

  async push(_opts: PushOpts): Promise<void> {
    throw Object.assign(new Error('push not implemented yet (Track B4)'), {
      code: 'INTERNAL',
    });
  }

  async status(workspaceId: string): Promise<{
    branch: string;
    dirty: boolean;
    ahead: number;
    behind: number;
  }> {
    const rec = this.store.get(workspaceId);
    if (!rec) {
      throw Object.assign(new Error(`workspace not found: ${workspaceId}`), { code: 'NOT_FOUND' });
    }
    // Pre-git: empty status
    return { branch: 'main', dirty: false, ahead: 0, behind: 0 };
  }

  async withWorkspaceLock<T>(workspaceId: string, fn: () => Promise<T>): Promise<T> {
    return this.lock.withLock(workspaceId, fn);
  }
}

export function createBrowserAgent(opts?: BrowserAgentOptions): BrowserAgent {
  return new ZCodeBrowserAgent(opts);
}
