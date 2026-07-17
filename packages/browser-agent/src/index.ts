export type { BrowserAgent } from '@zcode/protocol';
export { createBrowserAgent, createBrowserAgentAsync, ZCodeBrowserAgent } from './agent.js';
export type { BrowserAgentOptions } from './agent.js';
export { WorkspaceLock } from './lock.js';
export { WorkspaceStore } from './workspace-store.js';
export type { WorkspaceRecord } from './workspace-store.js';
export { MemoryFs } from './memory-fs.js';
export type { AgentFs } from './memory-fs.js';
export { IdbFs, isIdbAvailable } from './idb-fs.js';
export {
  createDefaultFs,
  createDefaultFsAsync,
  createDefaultFsInfo,
} from './default-fs.js';
export type { DefaultFsInfo, DefaultFsKind } from './default-fs.js';
export {
  ZenFsAgentFs,
  createZenFsOpfs,
  createZenFsMemory,
  isOpfsAvailable,
} from './zenfs-fs.js';
export type { FsBackendKind } from './zenfs-fs.js';
export { migrateIdbToFs } from './migrate-idb-to-opfs.js';
export type { MigrateResult } from './migrate-idb-to-opfs.js';
export { createIsoFs } from './iso-fs.js';
export { searchWorkspace } from './search.js';
export type { SearchHit, SearchOpts } from './search.js';
export { changeKindFromMatrix, gitListChanges } from './git.js';
export type { GitChange, GitChangeKind } from './git.js';
