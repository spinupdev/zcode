export type {
  IdeMode,
  ProductCapabilities,
  ConnectionHandle,
  WorkbenchLoadConfig,
  UpgradeOpts,
  RemoteConnectInfo,
  SessionController,
} from './session.js';

export {
  browserCapabilities,
  remoteCapabilities,
} from './session.js';

export type {
  BrowserAgent,
  BrowserAgentError,
  BrowserAgentErrorCode,
  WorkspaceInfo,
  CloneProgress,
  CloneOpts,
  CommitOpts,
  PushOpts,
  GitAuth,
} from './browser-agent.js';

export type { ModeResolutionInput } from './mode.js';
export {
  resolveMode,
  createWorkbenchLoadConfig,
  capabilitiesForMode,
} from './mode.js';

export type {
  ExecutionBackendId,
  ConnectionScope,
  RemoteConnectionStatus,
  ConnectionState,
  ExecutionBackendInfo,
  ExecutionBackend,
  RunFileOpts,
  RunSelectionOpts,
  RunResult,
  ExecutionRegistrySnapshot,
} from './execution.js';

export {
  disconnectedConnectionState,
  defaultBrowserExecutionBackends,
  remoteExecutionBackendInfo,
  resolveDefaultExecutionBackend,
} from './execution.js';
