/**
 * One-shot copy of workspace keys from legacy IndexedDB (zcode-fs-v1) into OPFS/ZenFS.
 * Keeps SPA ↔ workbench bridge working when users upgrade from B7 IDB to B2b OPFS.
 */
import type { AgentFs } from './memory-fs.js';
import { IdbFs, isIdbAvailable } from './idb-fs.js';

export interface MigrateResult {
  migrated: boolean;
  fileCount: number;
  skipped: boolean;
  reason?: string;
}

/**
 * If destination has no workspace/* files and IDB has some, copy all IDB entries.
 * Safe to call multiple times (no-op when dest already has content or IDB empty).
 */
export async function migrateIdbToFs(dest: AgentFs): Promise<MigrateResult> {
  if (!isIdbAvailable()) {
    return { migrated: false, fileCount: 0, skipped: true, reason: 'idb-unavailable' };
  }

  let destFiles: string[] = [];
  try {
    destFiles = dest.listFiles ? await dest.listFiles('workspace') : [];
  } catch {
    destFiles = [];
  }
  if (destFiles.length > 0) {
    return { migrated: false, fileCount: 0, skipped: true, reason: 'dest-has-workspace' };
  }

  const idb = new IdbFs();
  let srcFiles: string[] = [];
  try {
    srcFiles = (await idb.listFiles?.('workspace')) ?? [];
  } catch {
    return { migrated: false, fileCount: 0, skipped: true, reason: 'idb-list-failed' };
  }
  if (srcFiles.length === 0) {
    return { migrated: false, fileCount: 0, skipped: true, reason: 'idb-empty' };
  }

  let count = 0;
  for (const path of srcFiles) {
    try {
      const data = await idb.readFile(path);
      await dest.writeFile(path, data);
      count++;
    } catch {
      /* skip corrupt entry */
    }
  }

  // Also copy any non-workspace keys that look like agent metadata
  try {
    const all = (await idb.listFiles?.('')) ?? [];
    for (const path of all) {
      if (path.startsWith('workspace/')) continue;
      try {
        const data = await idb.readFile(path);
        await dest.writeFile(path, data);
        count++;
      } catch {
        /* skip */
      }
    }
  } catch {
    /* ignore */
  }

  return { migrated: count > 0, fileCount: count, skipped: false };
}
