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

/**
 * Cross-bundle shared cache.
 *
 * zcode-browser-fs and zcode-git each esbuild-bundle @zcode/browser-agent, so
 * module-level `let` caches are *not* shared. Use literal globalThis keys only.
 */
type GlobalFsBag = typeof globalThis & {
  __zcodeDefaultFsInfo__?: Promise<DefaultFsInfo>;
};

/**
 * Prefer OPFS (ZenFS WebAccess) → IndexedDB → Memory.
 * When OPFS wins and IDB has legacy workspaces, one-shot migrate.
 * OPFS failures/timeouts fall through to IDB so clone never hangs forever.
 */
export async function createDefaultFsAsync(): Promise<AgentFs> {
  const info = await createDefaultFsInfo();
  return info.fs;
}

export async function createDefaultFsInfo(): Promise<DefaultFsInfo> {
  const g = globalThis as GlobalFsBag;
  if (g.__zcodeDefaultFsInfo__) return g.__zcodeDefaultFsInfo__;

  // Claim slot synchronously before any await
  const created = (async (): Promise<DefaultFsInfo> => {
    if (isOpfsAvailable()) {
      try {
        const zen = await createZenFsOpfs();
        try {
          await migrateIdbToFs(zen);
        } catch {
          /* migration best-effort */
        }
        return { fs: zen, kind: 'opfs', zen };
      } catch (err) {
        console.warn(
          '[zcode] OPFS unavailable, falling back to IndexedDB:',
          err instanceof Error ? err.message : err,
        );
        /* fall through to IDB */
      }
    }
    if (isIdbAvailable()) {
      return { fs: new IdbFs(), kind: 'idb' };
    }
    return { fs: new MemoryFs(), kind: 'memory' };
  })();

  g.__zcodeDefaultFsInfo__ = created;

  try {
    return await created;
  } catch (e) {
    delete g.__zcodeDefaultFsInfo__;
    throw e;
  }
}

/** Test helper */
export function _resetDefaultFsCacheForTests(): void {
  delete (globalThis as GlobalFsBag).__zcodeDefaultFsInfo__;
}
