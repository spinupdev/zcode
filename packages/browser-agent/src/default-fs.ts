import { IdbFs, isIdbAvailable } from './idb-fs.js';
import type { AgentFs } from './memory-fs.js';
import { MemoryFs } from './memory-fs.js';
import { migrateIdbToFs } from './migrate-idb-to-opfs.js';
import {
  createZenFsOpfs,
  isOpfsAvailable,
  type ZenFsAgentFs,
} from './zenfs-fs.js';

export type DefaultFsKind = 'opfs' | 'idb' | 'memory';

export interface DefaultFsInfo {
  fs: AgentFs;
  kind: DefaultFsKind;
  /** Present when kind === 'opfs' */
  zen?: ZenFsAgentFs;
}

/**
 * Sync factory for Node tests and callers that cannot await.
 * Prefer createDefaultFsAsync() in browser so OPFS can win.
 *
 * Sync order: IDB (if present) → Memory.
 * (OPFS configure is async; use createDefaultFsAsync for B2b primary.)
 */
export function createDefaultFs(): AgentFs {
  if (isIdbAvailable()) {
    return new IdbFs();
  }
  return new MemoryFs();
}

let asyncCache: Promise<DefaultFsInfo> | null = null;

/**
 * Prefer OPFS (ZenFS WebAccess) → IndexedDB → Memory.
 * When OPFS wins and IDB has legacy workspaces, one-shot migrate.
 */
export async function createDefaultFsAsync(): Promise<AgentFs> {
  const info = await createDefaultFsInfo();
  return info.fs;
}

export async function createDefaultFsInfo(): Promise<DefaultFsInfo> {
  if (asyncCache) return asyncCache;

  asyncCache = (async (): Promise<DefaultFsInfo> => {
    if (isOpfsAvailable()) {
      try {
        const zen = await createZenFsOpfs();
        // Bridge B7 IDB workspaces into OPFS once
        try {
          await migrateIdbToFs(zen);
        } catch {
          /* migration best-effort */
        }
        return { fs: zen, kind: 'opfs', zen };
      } catch {
        /* fall through to IDB */
      }
    }
    if (isIdbAvailable()) {
      return { fs: new IdbFs(), kind: 'idb' };
    }
    return { fs: new MemoryFs(), kind: 'memory' };
  })();

  try {
    return await asyncCache;
  } catch (e) {
    asyncCache = null;
    throw e;
  }
}

/** Test helper */
export function _resetDefaultFsCacheForTests(): void {
  asyncCache = null;
}
