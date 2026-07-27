/**
 * AgentFs adapter over ZenFS (Node-like fs for isomorphic-git + durable backends).
 *
 * B2b primary: OPFS via @zenfs/dom WebAccess when available.
 * Tests: InMemory backend via createZenFsMemory().
 */
import { configureSingle, fs as zenFs, InMemory } from '@zenfs/core';
import type { AgentFs, AgentFsStat } from './memory-fs.js';

function norm(p: string): string {
  return p.replace(/\\/g, '/').replace(/\/+/g, '/').replace(/^\//, '').replace(/\/$/, '') || '';
}

/** AgentFs key (no leading slash) → ZenFS absolute path. */
function abs(path: string): string {
  const n = norm(path);
  return n ? `/${n}` : '/';
}

export type FsBackendKind = 'opfs' | 'memory' | 'idb-fallback';

export class ZenFsAgentFs implements AgentFs {
  readonly backend: FsBackendKind;
  private readonly ready: Promise<void>;

  constructor(ready: Promise<void>, backend: FsBackendKind) {
    this.ready = ready;
    this.backend = backend;
  }

  private async api() {
    await this.ready;
    return zenFs.promises;
  }

  async mkdir(path: string): Promise<void> {
    const p = abs(path);
    if (p === '/') return;
    const api = await this.api();
    await api.mkdir(p, { recursive: true });
  }

  async writeFile(path: string, data: Uint8Array | string): Promise<void> {
    const p = abs(path);
    const parent = p.includes('/') ? p.slice(0, p.lastIndexOf('/')) || '/' : '/';
    const api = await this.api();
    if (parent && parent !== '/') {
      await api.mkdir(parent, { recursive: true });
    }
    const buf = typeof data === 'string' ? new TextEncoder().encode(data) : data;
    await api.writeFile(p, buf);
  }

  async readFile(path: string): Promise<Uint8Array> {
    const api = await this.api();
    const p = abs(path);
    try {
      // ZenFS InMemory/IndexFS can return garbage bytes for directories; always
      // stat first so Explorer never mistakes dirs for empty files.
      const st = await api.stat(p);
      if (st.isDirectory()) {
        throw Object.assign(new Error(`EISDIR: ${path}`), { code: 'EISDIR' });
      }
      const data = await api.readFile(p);
      if (typeof data === 'string') return new TextEncoder().encode(data);
      return data instanceof Uint8Array ? data : new Uint8Array(data);
    } catch (e) {
      if (e && typeof e === 'object' && 'code' in e && (e as { code: string }).code === 'EISDIR') {
        throw e;
      }
      throw Object.assign(new Error(`ENOENT: ${path}`), { code: 'NOT_FOUND', cause: e });
    }
  }

  async stat(path: string): Promise<AgentFsStat> {
    const api = await this.api();
    try {
      const st = await api.stat(abs(path));
      if (st.isDirectory()) return { kind: 'dir', size: 0 };
      if (st.isFile()) return { kind: 'file', size: Number(st.size) || 0 };
      // Treat other types (symlinks, etc.) as files for Explorer
      return { kind: 'file', size: Number(st.size) || 0 };
    } catch (e) {
      throw Object.assign(new Error(`ENOENT: ${path}`), { code: 'NOT_FOUND', cause: e });
    }
  }

  async readdir(path: string): Promise<string[]> {
    const api = await this.api();
    const p = abs(path);
    try {
      const names = await api.readdir(p);
      return names.map(String).sort();
    } catch (e) {
      throw Object.assign(new Error(`ENOENT: ${path}`), { code: 'NOT_FOUND', cause: e });
    }
  }

  async rm(path: string, opts?: { recursive?: boolean }): Promise<void> {
    const api = await this.api();
    try {
      await api.rm(abs(path), { recursive: opts?.recursive ?? false, force: true });
    } catch {
      /* ignore missing */
    }
  }

  async exists(path: string): Promise<boolean> {
    const api = await this.api();
    try {
      await api.access(abs(path));
      return true;
    } catch {
      return false;
    }
  }

  async estimate(): Promise<{ usage: number; quota: number }> {
    let usage = 0;
    let quota = 512 * 1024 * 1024;
    try {
      if (typeof navigator !== 'undefined' && navigator.storage?.estimate) {
        const est = await navigator.storage.estimate();
        if (est.quota) quota = est.quota;
        if (est.usage != null) usage = est.usage;
      }
    } catch {
      /* ignore */
    }
    if (usage === 0 && this.listFiles) {
      try {
        const files = await this.listFiles();
        for (const f of files) {
          try {
            const data = await this.readFile(f);
            usage += data.byteLength;
          } catch {
            /* skip */
          }
        }
      } catch {
        /* ignore */
      }
    }
    return { usage, quota };
  }

  async listFiles(prefix = ''): Promise<string[]> {
    const api = await this.api();
    const root = abs(prefix);
    const out: string[] = [];

    const walk = async (dir: string): Promise<void> => {
      let names: string[];
      try {
        names = (await api.readdir(dir)).map(String);
      } catch {
        return;
      }
      for (const name of names) {
        const child = dir === '/' ? `/${name}` : `${dir}/${name}`;
        try {
          const st = await api.stat(child);
          if (st.isDirectory()) {
            await walk(child);
          } else if (st.isFile()) {
            out.push(norm(child));
          }
        } catch {
          /* skip broken entries */
        }
      }
    };

    // If prefix is a file, return it alone
    try {
      const st = await api.stat(root);
      if (st.isFile()) {
        return [norm(root)];
      }
    } catch {
      // prefix may not exist yet
      if (prefix) return [];
    }

    await walk(root === '/' ? '/' : root);
    return out.sort();
  }
}

/**
 * Hardcoded realm keys as *string literals* in every access (not const bindings).
 * esbuild ESM lazy-init can leave `const KEY = '…'` undefined if a hoisted
 * function runs before the init chunk — which produced globalThis["undefined"].
 */
type GlobalOpfsBag = typeof globalThis & {
  __zcodeZenFsOpfs__?: ZenFsAgentFs;
  __zcodeZenFsOpfsInit__?: Promise<ZenFsAgentFs>;
};

/** OPFS configure can hang under dual-open / worker races — never block clone forever. */
const OPFS_INIT_TIMEOUT_MS = 8_000;

export function isOpfsAvailable(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    typeof navigator.storage?.getDirectory === 'function'
  );
}

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

/**
 * Configure ZenFS on Origin Private File System under `zcode-workspaces/`.
 * Singleton per JS realm (window / extension host), including across bundles.
 */
export async function createZenFsOpfs(): Promise<ZenFsAgentFs> {
  const g = globalThis as GlobalOpfsBag;
  if (g.__zcodeZenFsOpfs__) return g.__zcodeZenFsOpfs__;
  if (g.__zcodeZenFsOpfsInit__) return g.__zcodeZenFsOpfsInit__;

  // Claim the global init slot *synchronously* before any await (cross-bundle race).
  const init = (async (): Promise<ZenFsAgentFs> => {
    if (!isOpfsAvailable()) {
      throw new Error('OPFS not available in this environment');
    }
    // Dynamic import keeps Node unit tests from loading DOM backend until needed
    const { WebAccess } = await import('@zenfs/dom');
    const root = await navigator.storage.getDirectory();
    const handle = await root.getDirectoryHandle('zcode-workspaces', { create: true });
    const ready = configureSingle({
      backend: WebAccess,
      handle,
      disableHandleCache: false,
    } as Parameters<typeof configureSingle>[0]);
    const agent = new ZenFsAgentFs(ready, 'opfs');
    await ready;
    try {
      await navigator.storage.persist?.();
    } catch {
      /* ignore */
    }
    g.__zcodeZenFsOpfs__ = agent;
    return agent;
  })();

  g.__zcodeZenFsOpfsInit__ = init;

  try {
    return await withTimeout(init, OPFS_INIT_TIMEOUT_MS, 'OPFS/ZenFS init');
  } catch (e) {
    delete g.__zcodeZenFsOpfsInit__;
    // Leave a failed init out of the singleton so IDB fallback can win
    throw e;
  }
}

/** In-memory ZenFS for unit tests (no OPFS). */
export async function createZenFsMemory(): Promise<ZenFsAgentFs> {
  const ready = configureSingle({ backend: InMemory });
  const agent = new ZenFsAgentFs(ready, 'memory');
  await ready;
  return agent;
}
