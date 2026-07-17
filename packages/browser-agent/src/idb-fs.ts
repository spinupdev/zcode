/**
 * Durable AgentFs backed by IndexedDB (browser).
 * Survives reloads; used for browser-mode workspaces.
 */
import type { AgentFs } from './memory-fs.js';

const DB_NAME = 'zcode-fs-v1';
const STORE = 'entries';

type EntryKind = 'file' | 'dir';

interface StoredEntry {
  path: string;
  kind: EntryKind;
  /** base64 for files (simple, portable) */
  dataB64?: string;
}

function norm(p: string): string {
  return p.replace(/\\/g, '/').replace(/\/+/g, '/').replace(/^\//, '').replace(/\/$/, '') || '';
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'path' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('idb open failed'));
  });
}

function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('idb tx failed'));
    tx.onabort = () => reject(tx.error ?? new Error('idb tx aborted'));
  });
}

function b64encode(data: Uint8Array): string {
  let s = '';
  const chunk = 0x8000;
  for (let i = 0; i < data.length; i += chunk) {
    s += String.fromCharCode(...data.subarray(i, i + chunk));
  }
  return btoa(s);
}

function b64decode(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export class IdbFs implements AgentFs {
  private dbPromise: Promise<IDBDatabase> | null = null;

  private db(): Promise<IDBDatabase> {
    if (!this.dbPromise) this.dbPromise = openDb();
    return this.dbPromise;
  }

  private async get(path: string): Promise<StoredEntry | undefined> {
    const db = await this.db();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).get(path);
      req.onsuccess = () => resolve(req.result as StoredEntry | undefined);
      req.onerror = () => reject(req.error);
    });
  }

  private async put(entry: StoredEntry): Promise<void> {
    const db = await this.db();
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(entry);
    await txDone(tx);
  }

  private async del(path: string): Promise<void> {
    const db = await this.db();
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(path);
    await txDone(tx);
  }

  private async allKeys(): Promise<string[]> {
    const db = await this.db();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).getAllKeys();
      req.onsuccess = () => resolve((req.result as IDBValidKey[]).map(String));
      req.onerror = () => reject(req.error);
    });
  }

  async mkdir(path: string): Promise<void> {
    const n = norm(path);
    if (!n) return;
    const parts = n.split('/');
    let cur = '';
    for (const part of parts) {
      cur = cur ? `${cur}/${part}` : part;
      const existing = await this.get(cur);
      if (existing?.kind === 'file') {
        throw Object.assign(new Error(`ENOTDIR: ${cur}`), { code: 'ENOTDIR' });
      }
      if (!existing) await this.put({ path: cur, kind: 'dir' });
    }
  }

  async writeFile(path: string, data: Uint8Array | string): Promise<void> {
    const n = norm(path);
    const parent = n.includes('/') ? n.slice(0, n.lastIndexOf('/')) : '';
    if (parent) await this.mkdir(parent);
    const buf = typeof data === 'string' ? new TextEncoder().encode(data) : data;
    await this.put({ path: n, kind: 'file', dataB64: b64encode(buf) });
  }

  async readFile(path: string): Promise<Uint8Array> {
    const n = norm(path);
    const e = await this.get(n);
    if (!e || e.kind !== 'file' || e.dataB64 == null) {
      throw Object.assign(new Error(`ENOENT: ${path}`), { code: 'NOT_FOUND' });
    }
    return b64decode(e.dataB64);
  }

  async readdir(path: string): Promise<string[]> {
    const n = norm(path);
    if (n) {
      const self = await this.get(n);
      const keys = await this.allKeys();
      const hasChild = keys.some((k) => k === n || k.startsWith(n + '/'));
      if (!self && !hasChild) {
        throw Object.assign(new Error(`ENOENT: ${path}`), { code: 'NOT_FOUND' });
      }
    }
    const prefix = n ? `${n}/` : '';
    const keys = await this.allKeys();
    const names = new Set<string>();
    for (const k of keys) {
      if (!k.startsWith(prefix) || k === n) continue;
      const rest = k.slice(prefix.length);
      names.add(rest.split('/')[0]!);
    }
    return [...names].sort();
  }

  async rm(path: string, opts?: { recursive?: boolean }): Promise<void> {
    const n = norm(path);
    const keys = await this.allKeys();
    if (opts?.recursive) {
      for (const k of keys) {
        if (k === n || k.startsWith(n + '/')) await this.del(k);
      }
      return;
    }
    await this.del(n);
  }

  async exists(path: string): Promise<boolean> {
    const n = norm(path);
    if (await this.get(n)) return true;
    const keys = await this.allKeys();
    return keys.some((k) => k.startsWith(n + '/'));
  }

  async estimate(): Promise<{ usage: number; quota: number }> {
    let usage = 0;
    const keys = await this.allKeys();
    for (const k of keys) {
      const e = await this.get(k);
      if (e?.kind === 'file' && e.dataB64) {
        usage += Math.floor((e.dataB64.length * 3) / 4);
      }
    }
    let quota = 512 * 1024 * 1024;
    try {
      if (navigator.storage?.estimate) {
        const est = await navigator.storage.estimate();
        if (est.quota) quota = est.quota;
        if (est.usage != null) usage = Math.max(usage, est.usage);
      }
    } catch {
      /* ignore */
    }
    return { usage, quota };
  }

  async listFiles(prefix = ''): Promise<string[]> {
    const n = norm(prefix);
    const keys = await this.allKeys();
    const out: string[] = [];
    for (const k of keys) {
      const e = await this.get(k);
      if (e?.kind !== 'file') continue;
      if (!n || k === n || k.startsWith(n + '/')) out.push(k);
    }
    return out.sort();
  }
}

export function isIdbAvailable(): boolean {
  return typeof indexedDB !== 'undefined';
}
