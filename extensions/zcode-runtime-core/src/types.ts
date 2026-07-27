/** Shared runtime types (mirrors @zcode/protocol ExecutionBackend; no workspace dep for slim web bundle). */

export type ExecutionBackendId = string;

export interface ExecutionBackendInfo {
  id: ExecutionBackendId;
  label: string;
  languages: string[];
  requiresNetwork: boolean;
  requiresRemote: boolean;
}

export interface RunFileOpts {
  uri: string;
  path?: string;
  code: string;
  languageId: string;
  cwd?: string;
  signal?: AbortSignal;
  /** Write line-oriented output */
  onStdout?: (chunk: string) => void;
  onStderr?: (chunk: string) => void;
}

export interface RunResult {
  exitCode: number;
  stdout?: string;
  stderr?: string;
  streamed?: boolean;
}

export interface ExecutionBackend {
  readonly id: ExecutionBackendId;
  readonly info: ExecutionBackendInfo;
  startSession?(): Promise<void>;
  run(opts: RunFileOpts): Promise<RunResult>;
  /**
   * Optional interactive terminal (Pseudoterminal).
   * WebContainer shell / Pyodide REPL implement this via extension commands;
   * optional hook for a shared “Open Shell” entry point.
   */
  openTerminal?(): void;
  dispose(): void;
}

export interface ZcodeRuntimeApi {
  register(backend: ExecutionBackend): void;
  unregister(id: ExecutionBackendId): void;
  list(): ExecutionBackendInfo[];
  get(id: ExecutionBackendId): ExecutionBackend | undefined;
  setActive(id: ExecutionBackendId | 'auto'): void;
  getActiveId(languageId?: string): ExecutionBackendId;
  /** Fired when backends or active selection change */
  onDidChange(listener: () => void): { dispose(): void };
}

declare global {
  // eslint-disable-next-line no-var
  var zcodeRuntime: ZcodeRuntimeApi | undefined;
}

export {};
