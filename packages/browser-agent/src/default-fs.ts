import { IdbFs, isIdbAvailable } from './idb-fs.js';
import type { AgentFs } from './memory-fs.js';
import { MemoryFs } from './memory-fs.js';

/**
 * Prefer IndexedDB in browsers; MemoryFs in Node / workers without IDB.
 */
export function createDefaultFs(): AgentFs {
  if (isIdbAvailable()) {
    return new IdbFs();
  }
  return new MemoryFs();
}
