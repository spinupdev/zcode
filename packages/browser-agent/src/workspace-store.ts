import type { WorkspaceInfo } from '@zcode/protocol';
import { randomUUID } from 'node:crypto';

export interface WorkspaceRecord extends WorkspaceInfo {
  /** Logical root key in the FS backend */
  rootKey: string;
}

/**
 * Metadata registry for browser workspaces.
 * File bytes live in a FS backend (memory for tests, ZenFS+OPFS in browser).
 */
export class WorkspaceStore {
  private readonly byId = new Map<string, WorkspaceRecord>();

  list(): WorkspaceInfo[] {
    return [...this.byId.values()].map(toInfo);
  }

  get(id: string): WorkspaceRecord | undefined {
    return this.byId.get(id);
  }

  create(name: string, id = randomUUID()): WorkspaceRecord {
    if (this.byId.has(id)) {
      throw Object.assign(new Error(`workspace already exists: ${id}`), {
        code: 'ALREADY_EXISTS',
      });
    }
    const rec: WorkspaceRecord = {
      id,
      name,
      uri: `zcode-opfs://workspace/${id}/`,
      createdAt: new Date().toISOString(),
      rootKey: `workspace/${id}`,
      approxBytes: 0,
    };
    this.byId.set(id, rec);
    return rec;
  }

  delete(id: string): void {
    if (!this.byId.has(id)) {
      throw Object.assign(new Error(`workspace not found: ${id}`), { code: 'NOT_FOUND' });
    }
    this.byId.delete(id);
  }

  updateBytes(id: string, approxBytes: number): void {
    const rec = this.byId.get(id);
    if (!rec) {
      throw Object.assign(new Error(`workspace not found: ${id}`), { code: 'NOT_FOUND' });
    }
    rec.approxBytes = approxBytes;
  }
}

function toInfo(r: WorkspaceRecord): WorkspaceInfo {
  return {
    id: r.id,
    name: r.name,
    uri: r.uri,
    createdAt: r.createdAt,
    approxBytes: r.approxBytes,
  };
}
