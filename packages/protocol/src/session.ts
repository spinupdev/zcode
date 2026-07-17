/**
 * Product-level session types for ZCode.
 *
 * These configure the VS Code workbench; they do NOT proxy VS Code
 * file / terminal / extension-host IPC (that remains upstream).
 */

export type IdeMode = 'browser' | 'remote';

/** UI capability matrix — drives chrome visibility, not editor IPC. */
export interface ProductCapabilities {
  terminal: boolean;
  remoteExtensions: boolean;
  webExtensions: boolean;
  nativeGit: boolean;
  browserGit: boolean;
  debug: boolean;
  search: 'ripgrep' | 'web-best-effort' | 'none';
  fileWatcher: 'native' | 'polling' | 'none';
  maxWorkspaceBytes?: number;
}

/**
 * After auth, product state only.
 * `{ ready: true }` means an HttpOnly session cookie (or localhost escape hatch)
 * is in place. The workbench must NOT receive a long-lived connection token here.
 */
export type ConnectionHandle = { ready: true; authority: string };

/**
 * Inputs the shell uses to construct workbench load options.
 *
 * MVP `remoteAuthority`: hostname or host:port only (e.g. "localhost:8080").
 * Do not use custom prefixes like "zcode+..." until a RemoteAuthorityResolver exists.
 */
export interface WorkbenchLoadConfig {
  remoteAuthority?: string;
  /** e.g. zcode-opfs://workspace/<id>/ or vscode-remote://<authority>/home/workspace */
  workspaceUri?: string;
  resolvedConnection?: ConnectionHandle;
  productConfiguration?: Record<string, unknown>;
  additionalBuiltinExtensions?: string[];
}

export interface UpgradeOpts {
  /** Target remote workspace path on server */
  remoteWorkspacePath?: string;
  /** Prefer git bundle export when possible */
  preferGitBundle?: boolean;
}

export interface RemoteConnectInfo {
  authority: string;
  /** Attach URL without secrets in query (same-origin cookie already set) */
  attachUrl: string;
}

/**
 * Product session controller — mode, capabilities, upgrade orchestration.
 * Does not answer file/terminal/EH RPCs.
 */
export interface SessionController {
  readonly mode: IdeMode;
  createWorkbenchLoadConfig(): WorkbenchLoadConfig;
  capabilities(): ProductCapabilities;
  requestRemoteUpgrade?(opts: UpgradeOpts): Promise<RemoteConnectInfo>;
  dispose(): void;
}

export function browserCapabilities(): ProductCapabilities {
  return {
    terminal: false,
    remoteExtensions: false,
    webExtensions: true,
    nativeGit: false,
    browserGit: true,
    debug: false,
    search: 'web-best-effort',
    fileWatcher: 'polling',
  };
}

export function remoteCapabilities(): ProductCapabilities {
  return {
    terminal: true,
    remoteExtensions: true,
    webExtensions: true,
    nativeGit: true,
    browserGit: false,
    debug: true,
    search: 'ripgrep',
    fileWatcher: 'native',
  };
}
