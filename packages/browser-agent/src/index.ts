/**
 * Browser agent library (workspace FS coordination + locks).
 * Memory backend for Node/tests; ZenFS+OPFS adapter follows in B2 browser wiring.
 */

export type { BrowserAgent } from '@zcode/protocol';
export { createBrowserAgent, ZCodeBrowserAgent } from './agent.js';
export type { BrowserAgentOptions } from './agent.js';
export { WorkspaceLock } from './lock.js';
export { WorkspaceStore } from './workspace-store.js';
export type { WorkspaceRecord } from './workspace-store.js';
export { MemoryFs } from './memory-fs.js';
export type { AgentFs } from './memory-fs.js';
