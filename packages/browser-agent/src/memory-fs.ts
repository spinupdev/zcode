/**
 * Minimal async FS used by the browser agent in Node tests and as a
 * stand-in before ZenFS+OPFS is wired in the browser (B2/B3).
 */

export interface AgentFs {
  mkdir(path: string): Promise<void>;
  writeFile(path: string, data: Uint8Array | string): Promise<void>;
  readFile(path: string): Promise<Uint8Array>;
  readdir(path: string): Promise<string[]>;
  rm(path: string, opts?: { recursive?: boolean }): Promise<void>;
  exists(path: string): Promise<boolean>;
  estimate(): Promise<{ usage: number; quota: number }>;
}

function norm(p: string): string {
  return p.replace(/\\/g, '/').replace(/\/+/g, '/').replace(/^\//, '').replace(/\/$/, '') || '';
}

export class MemoryFs implements AgentFs {
  private readonly files = new Map<string, Uint8Array>();
  private readonly dirs = new Set<string>(['']);

  async mkdir(path: string): Promise<void> {
    const n = norm(path);
    if (!n) return;
    const parts = n.split('/');
    let cur = '';
    for (const part of parts) {
      cur = cur ? `${cur}/${part}` : part;
      this.dirs.add(cur);
    }
  }

  async writeFile(path: string, data: Uint8Array | string): Promise<void> {
    const n = norm(path);
    const parent = n.includes('/') ? n.slice(0, n.lastIndexOf('/')) : '';
    if (parent) await this.mkdir(parent);
    const buf = typeof data === 'string' ? new TextEncoder().encode(data) : data;
    this.files.set(n, buf);
  }

  async readFile(path: string): Promise<Uint8Array> {
    const n = norm(path);
    const f = this.files.get(n);
    if (!f) throw Object.assign(new Error(`ENOENT: ${path}`), { code: 'NOT_FOUND' });
    return f;
  }

  async readdir(path: string): Promise<string[]> {
    const n = norm(path);
    if (n && !this.dirs.has(n)) {
      throw Object.assign(new Error(`ENOENT: ${path}`), { code: 'NOT_FOUND' });
    }
    const prefix = n ? `${n}/` : '';
    const names = new Set<string>();
    for (const d of this.dirs) {
      if (!d.startsWith(prefix) || d === n) continue;
      const rest = d.slice(prefix.length);
      if (!rest.includes('/')) names.add(rest);
    }
    for (const f of this.files.keys()) {
      if (!f.startsWith(prefix)) continue;
      const rest = f.slice(prefix.length);
      if (!rest.includes('/')) names.add(rest);
    }
    return [...names].sort();
  }

  async rm(path: string, opts?: { recursive?: boolean }): Promise<void> {
    const n = norm(path);
    if (opts?.recursive) {
      for (const f of [...this.files.keys()]) {
        if (f === n || f.startsWith(`${n}/`)) this.files.delete(f);
      }
      for (const d of [...this.dirs]) {
        if (d === n || d.startsWith(`${n}/`)) this.dirs.delete(d);
      }
      return;
    }
    this.files.delete(n);
    this.dirs.delete(n);
  }

  async exists(path: string): Promise<boolean> {
    const n = norm(path);
    return this.files.has(n) || this.dirs.has(n);
  }

  async estimate(): Promise<{ usage: number; quota: number }> {
    let usage = 0;
    for (const f of this.files.values()) usage += f.byteLength;
    return { usage, quota: 512 * 1024 * 1024 };
  }
}
