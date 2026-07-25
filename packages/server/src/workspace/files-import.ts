/**
 * Browser → remote workspace import (WS1 / ADR 0002).
 *
 * v1 transport: JSON "files-v1" map (path → utf8 or base64).
 * Git bundle / tar can layer on later without changing the route.
 */
import fs from 'node:fs';
import path from 'node:path';

export const MAX_IMPORT_BYTES = 25 * 1024 * 1024; // 25 MiB
export const MAX_FILE_COUNT = 5000;

export type FilesV1Payload = {
  format: 'files-v1';
  /** Relative paths using / separators, no leading slash */
  files: Record<string, { encoding: 'utf8' | 'base64'; data: string }>;
  /** Optional workspace label */
  workspaceId?: string;
};

export type ImportResult = {
  ok: true;
  root: string;
  fileCount: number;
  bytesWritten: number;
};

export class ImportError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
    this.name = 'ImportError';
  }
}

/** Reject path traversal and absolute paths. */
export function safeRelPath(rel: string): string {
  const normalized = rel.replace(/\\/g, '/').replace(/^\/+/, '');
  if (!normalized || normalized.includes('\0')) {
    throw new ImportError(`invalid path: ${rel}`);
  }
  if (normalized.split('/').some((p) => p === '..' || p === '')) {
    throw new ImportError(`invalid path segment: ${rel}`);
  }
  if (path.isAbsolute(normalized)) {
    throw new ImportError(`absolute paths not allowed: ${rel}`);
  }
  return normalized;
}

export function parseFilesV1(raw: unknown): FilesV1Payload {
  if (!raw || typeof raw !== 'object') {
    throw new ImportError('body must be a JSON object');
  }
  const body = raw as Partial<FilesV1Payload>;
  if (body.format !== 'files-v1') {
    throw new ImportError('unsupported format (expected files-v1)');
  }
  if (!body.files || typeof body.files !== 'object' || Array.isArray(body.files)) {
    throw new ImportError('files map required');
  }
  const keys = Object.keys(body.files);
  if (keys.length === 0) {
    throw new ImportError('files map is empty');
  }
  if (keys.length > MAX_FILE_COUNT) {
    throw new ImportError(`too many files (max ${MAX_FILE_COUNT})`);
  }
  return body as FilesV1Payload;
}

/**
 * Write files under workspaceRoot. Existing files are overwritten; dirs created as needed.
 * Does not delete pre-existing remote files (replace-empty policy for empty trees).
 */
export function importFilesV1(workspaceRoot: string, payload: FilesV1Payload): ImportResult {
  const root = path.resolve(workspaceRoot);
  fs.mkdirSync(root, { recursive: true });

  let bytesWritten = 0;
  let fileCount = 0;

  for (const [relRaw, entry] of Object.entries(payload.files)) {
    const rel = safeRelPath(relRaw);
    if (!entry || typeof entry !== 'object') {
      throw new ImportError(`invalid entry for ${rel}`);
    }
    const encoding = entry.encoding === 'base64' ? 'base64' : 'utf8';
    if (typeof entry.data !== 'string') {
      throw new ImportError(`missing data for ${rel}`);
    }

    let buf: Buffer;
    try {
      buf = encoding === 'base64' ? Buffer.from(entry.data, 'base64') : Buffer.from(entry.data, 'utf8');
    } catch {
      throw new ImportError(`decode failed for ${rel}`);
    }

    bytesWritten += buf.byteLength;
    if (bytesWritten > MAX_IMPORT_BYTES) {
      throw new ImportError(`import exceeds max size (${MAX_IMPORT_BYTES} bytes)`, 413);
    }

    const dest = path.resolve(root, rel);
    if (!dest.startsWith(root + path.sep) && dest !== root) {
      throw new ImportError(`path escapes workspace: ${rel}`);
    }

    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, buf);
    fileCount += 1;
  }

  // Marker for diagnostics
  try {
    fs.writeFileSync(
      path.join(root, '.zcode-import.json'),
      JSON.stringify({
        format: 'files-v1',
        workspaceId: payload.workspaceId,
        fileCount,
        bytesWritten,
        importedAt: new Date().toISOString(),
      }),
      'utf8',
    );
  } catch {
    /* non-fatal */
  }

  return { ok: true, root, fileCount, bytesWritten };
}

/** Export workspace tree as files-v1 (for detach / tests). */
export function exportFilesV1(
  workspaceRoot: string,
  opts: { maxBytes?: number; maxFiles?: number } = {},
): FilesV1Payload {
  const root = path.resolve(workspaceRoot);
  const maxBytes = opts.maxBytes ?? MAX_IMPORT_BYTES;
  const maxFiles = opts.maxFiles ?? MAX_FILE_COUNT;
  const files: FilesV1Payload['files'] = {};
  let total = 0;
  let count = 0;

  const walk = (dir: string, prefix: string) => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of entries) {
      if (ent.name === '.zcode-import.json') continue;
      const rel = prefix ? `${prefix}/${ent.name}` : ent.name;
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        walk(full, rel);
      } else if (ent.isFile()) {
        const buf = fs.readFileSync(full);
        total += buf.byteLength;
        count += 1;
        if (count > maxFiles) throw new ImportError(`too many files to export`, 413);
        if (total > maxBytes) throw new ImportError(`export exceeds max size`, 413);
        // Prefer utf8 when valid; else base64
        const asUtf8 = buf.toString('utf8');
        const isText = !asUtf8.includes('\uFFFD') && !/[\x00-\x08\x0e-\x1f]/.test(asUtf8);
        files[rel] = isText
          ? { encoding: 'utf8', data: asUtf8 }
          : { encoding: 'base64', data: buf.toString('base64') };
      }
    }
  };

  if (fs.existsSync(root)) walk(root, '');
  return { format: 'files-v1', files };
}
