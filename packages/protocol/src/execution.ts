/**
 * Pluggable execution backends + remote connection state (SA2 / ADR 0001).
 *
 * These are product-level types for extensions and shell chrome.
 * They do NOT replace VS Code file/terminal/EH IPC.
 */

/** Built-in and future execution backend identifiers. */
export type ExecutionBackendId =
  | 'none'
  | 'browser-python'
  | 'browser-node'
  | 'remote-reh'
  | (string & {});

/**
 * How deeply the workbench is connected to a remote REH.
 * - none: browser-only (default)
 * - execution: run/PTY/tasks on REH; workspace FS stays client (no reload ideal)
 * - workspace: full remoteAuthority + remote FS (Tier 1 may reload)
 */
export type ConnectionScope = 'none' | 'execution' | 'workspace';

export type RemoteConnectionStatus =
  | 'disconnected'
  | 'connecting'
  | 'attached'
  | 'error';

export interface ConnectionState {
  remote: RemoteConnectionStatus;
  /** host or host:port — same-origin MVP uses location.host */
  authority?: string;
  scope: ConnectionScope;
  /** Last error message when remote === 'error' (no secrets) */
  errorMessage?: string;
}

export interface ExecutionBackendInfo {
  id: ExecutionBackendId;
  /** Human label for status bar / picker */
  label: string;
  /** Languages this backend primarily handles */
  languages: string[];
  /** true when backend needs network (e.g. download Pyodide / REH) */
  requiresNetwork: boolean;
  /** true when REH must be attached */
  requiresRemote: boolean;
}

/** Minimal provider contract for runtime extensions (WB0). */
export interface ExecutionBackend {
  readonly id: ExecutionBackendId;
  readonly info: ExecutionBackendInfo;

  /** Lazy init (download WASM, open worker, etc.) */
  startSession?(): Promise<void>;

  runFile(opts: RunFileOpts): Promise<RunResult>;
  runSelection?(opts: RunSelectionOpts): Promise<RunResult>;

  dispose(): void;
}

export interface RunFileOpts {
  /** Workspace URI (e.g. zcode-opfs:/workspace/default/main.py) */
  uri: string;
  /** Absolute or workspace-relative path for display */
  path?: string;
  cwd?: string;
  env?: Record<string, string>;
  /** Signal cancellation */
  signal?: AbortSignal;
}

export interface RunSelectionOpts extends RunFileOpts {
  code: string;
  languageId: string;
}

export interface RunResult {
  exitCode: number;
  /** Combined or primary stdout (may be empty if streamed to terminal) */
  stdout?: string;
  stderr?: string;
  /** true if output was written to a VS Code terminal / channel */
  streamed?: boolean;
}

export interface ExecutionRegistrySnapshot {
  backends: ExecutionBackendInfo[];
  activeId: ExecutionBackendId;
  connection: ConnectionState;
}

export function disconnectedConnectionState(): ConnectionState {
  return { remote: 'disconnected', scope: 'none' };
}

export function defaultBrowserExecutionBackends(): ExecutionBackendInfo[] {
  return [
    {
      id: 'browser-python',
      label: 'Python (browser / Pyodide)',
      languages: ['python'],
      requiresNetwork: true,
      requiresRemote: false,
    },
    {
      id: 'browser-node',
      label: 'Node / JavaScript (browser)',
      languages: ['javascript', 'typescript', 'javascriptreact', 'typescriptreact'],
      requiresNetwork: true,
      requiresRemote: false,
    },
  ];
}

export function remoteExecutionBackendInfo(): ExecutionBackendInfo {
  return {
    id: 'remote-reh',
    label: 'Remote (REH)',
    languages: ['*'],
    requiresNetwork: true,
    requiresRemote: true,
  };
}

/**
 * Resolve default backend for a language given connection + available backends.
 * Prefer remote-reh when attached (workspace or execution); else first matching browser backend.
 */
export function resolveDefaultExecutionBackend(
  languageId: string,
  connection: ConnectionState,
  available: ExecutionBackendInfo[],
): ExecutionBackendId {
  const remoteOk =
    (connection.remote === 'attached' &&
      (connection.scope === 'execution' || connection.scope === 'workspace')) ||
    false;

  if (remoteOk && available.some((b) => b.id === 'remote-reh')) {
    return 'remote-reh';
  }

  const lang = languageId.toLowerCase();
  const match = available.find(
    (b) =>
      !b.requiresRemote &&
      (b.languages.includes('*') || b.languages.map((l) => l.toLowerCase()).includes(lang)),
  );
  return match?.id ?? 'none';
}
