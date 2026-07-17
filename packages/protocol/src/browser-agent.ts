/**
 * BrowserAgent IDL — product RPC between web extensions and the browser agent
 * (git worker + FS coordination). Not on the VS Code remote IPC bus.
 */

export type BrowserAgentErrorCode =
  | 'NOT_FOUND'
  | 'ALREADY_EXISTS'
  | 'LOCK_HELD'
  | 'QUOTA'
  | 'GIT_ERROR'
  | 'PROXY_REQUIRED'
  | 'CANCELLED'
  | 'INTERNAL';

export interface BrowserAgentError {
  code: BrowserAgentErrorCode;
  message: string;
  details?: Record<string, unknown>;
}

export interface WorkspaceInfo {
  id: string;
  name: string;
  /** zcode-opfs://workspace/<id>/ */
  uri: string;
  createdAt: string;
  approxBytes?: number;
}

export interface CloneProgress {
  phase: 'negotiating' | 'receiving' | 'resolving' | 'done';
  receivedObjects?: number;
  totalObjects?: number;
  message?: string;
}

export interface CloneOpts {
  workspaceId: string;
  url: string;
  ref?: string;
  depth?: number;
  /** Absolute URL of zcode git-proxy (required for non-CORS hosts) */
  corsProxyUrl: string;
  onProgress?: (p: CloneProgress) => void;
  signal?: AbortSignal;
}

export interface CommitOpts {
  workspaceId: string;
  message: string;
  author?: { name: string; email: string };
}

export interface PushOpts {
  workspaceId: string;
  remote?: string;
  corsProxyUrl: string;
  force?: boolean;
}

/**
 * Draft BrowserAgent surface (MVP). Implementations live in @zcode/browser-agent.
 */
export interface BrowserAgent {
  createWorkspace(name: string): Promise<WorkspaceInfo>;
  listWorkspaces(): Promise<WorkspaceInfo[]>;
  deleteWorkspace(id: string): Promise<void>;
  storageEstimate(): Promise<{ usage: number; quota: number }>;

  clone(opts: CloneOpts): Promise<WorkspaceInfo>;
  commit(opts: CommitOpts): Promise<{ oid: string }>;
  push(opts: PushOpts): Promise<void>;
  status(workspaceId: string): Promise<{
    branch: string;
    dirty: boolean;
    ahead: number;
    behind: number;
  }>;

  /** Acquire single-writer lock shared with FileSystemProvider. */
  withWorkspaceLock<T>(workspaceId: string, fn: () => Promise<T>): Promise<T>;
}
