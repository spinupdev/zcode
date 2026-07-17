/**
 * Adapter from AgentFs → isomorphic-git Promise-style fs API.
 */
import type { AgentFs } from './memory-fs.js';

export interface IsoStat {
  isFile(): boolean;
  isDirectory(): boolean;
  isSymbolicLink(): boolean;
  mode: number;
  size: number;
  mtimeMs: number;
  ctimeMs: number;
  mtime: Date;
  ctime: Date;
  uid: number;
  gid: number;
  dev: number;
  ino: number;
}

export function createIsoFs(fs: AgentFs, rootPrefix: string) {
  const root = rootPrefix.replace(/\/$/, '');

  function map(p: string): string {
    const cleaned = p.replace(/\\/g, '/').replace(/^\.\//, '');
    if (cleaned === '.' || cleaned === '') return root;
    const rel = cleaned.startsWith('/') ? cleaned.slice(1) : cleaned;
    return `${root}/${rel}`.replace(/\/+/g, '/');
  }

  function makeStat(isFile: boolean, size: number): IsoStat {
    const now = Date.now();
    const d = new Date(now);
    return {
      isFile: () => isFile,
      isDirectory: () => !isFile,
      isSymbolicLink: () => false,
      mode: isFile ? 0o100644 : 0o040755,
      size,
      mtimeMs: now,
      ctimeMs: now,
      mtime: d,
      ctime: d,
      uid: 0,
      gid: 0,
      dev: 1,
      ino: Math.floor(Math.random() * 1e9),
    };
  }

  async function exists(p: string): Promise<boolean> {
    return fs.exists(map(p));
  }

  return {
    promises: {
      async readFile(path: string, options?: { encoding?: string } | string) {
        const data = await fs.readFile(map(path));
        const enc = typeof options === 'string' ? options : options?.encoding;
        if (enc === 'utf8' || enc === 'utf-8') {
          return new TextDecoder().decode(data);
        }
        return data;
      },
      async writeFile(path: string, data: string | Uint8Array) {
        await fs.writeFile(map(path), data);
      },
      async unlink(path: string) {
        await fs.rm(map(path));
      },
      async readdir(path: string) {
        return fs.readdir(map(path));
      },
      async mkdir(path: string, opts?: { recursive?: boolean }) {
        if (opts?.recursive) {
          const full = map(path);
          const parts = full.split('/').filter(Boolean);
          let cur = '';
          for (const part of parts) {
            cur = cur ? `${cur}/${part}` : part;
            await fs.mkdir(cur);
          }
          return;
        }
        await fs.mkdir(map(path));
      },
      async rmdir(path: string) {
        await fs.rm(map(path), { recursive: true });
      },
      async stat(path: string): Promise<IsoStat> {
        const p = map(path);
        if (!(await fs.exists(p))) {
          const err = new Error(`ENOENT: ${path}`) as NodeJS.ErrnoException;
          err.code = 'ENOENT';
          throw err;
        }
        try {
          const data = await fs.readFile(p);
          return makeStat(true, data.byteLength);
        } catch {
          return makeStat(false, 0);
        }
      },
      async lstat(path: string) {
        return this.stat(path);
      },
      async readlink(_path: string) {
        const err = new Error('EINVAL: not a symlink') as NodeJS.ErrnoException;
        err.code = 'EINVAL';
        throw err;
      },
      async symlink() {
        /* no-op for memory backend */
      },
      async chmod() {
        /* no-op */
      },
    },
    exists,
  };
}
