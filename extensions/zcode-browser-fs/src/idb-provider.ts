/**
 * VS Code FileSystemProvider over AgentFs (B2b: OPFS/ZenFS primary, IDB fallback).
 * Path layout matches SPA: workspace/<id>/... under scheme zcode-opfs.
 */
import type { AgentFs } from '@zcode/browser-agent';
import { IdbFs } from '@zcode/browser-agent';
import * as vscode from 'vscode';

export class IdbFileSystemProvider implements vscode.FileSystemProvider {
  private fs: AgentFs;
  private readonly emitter = new vscode.EventEmitter<vscode.FileChangeEvent[]>();
  readonly onDidChangeFile = this.emitter.event;
  /** Storage backend label for diagnostics / seed text */
  storageLabel: string;

  constructor(fs: AgentFs = new IdbFs(), storageLabel = 'IndexedDB zcode-fs-v1') {
    this.fs = fs;
    this.storageLabel = storageLabel;
  }

  /** Map vscode URI path → AgentFs key (no leading/trailing slash). */
  private key(uri: vscode.Uri): string {
    return uri.path.replace(/^\/+/, '').replace(/\/+$/, '');
  }

  watch(
    _uri: vscode.Uri,
    _options: { recursive: boolean; excludes: string[] },
  ): vscode.Disposable {
    return new vscode.Disposable(() => {
      /* no-op */
    });
  }

  /** Force Explorer refresh after external clone/write (same FS backend). */
  notifyChanged(uri: vscode.Uri, type: vscode.FileChangeType = vscode.FileChangeType.Changed): void {
    this.emitter.fire([{ type, uri }]);
  }

  /** Swap backing store (e.g. IDB → OPFS) without re-registering the provider. */
  setFs(fs: AgentFs, storageLabel?: string): void {
    this.fs = fs;
    if (storageLabel) this.storageLabel = storageLabel;
  }

  async stat(uri: vscode.Uri): Promise<vscode.FileStat> {
    const k = this.key(uri);
    const now = Date.now();
    if (!k) {
      return { type: vscode.FileType.Directory, ctime: now, mtime: now, size: 0 };
    }
    if (!(await this.fs.exists(k))) {
      throw vscode.FileSystemError.FileNotFound(uri);
    }
    try {
      const data = await this.fs.readFile(k);
      return {
        type: vscode.FileType.File,
        ctime: now,
        mtime: now,
        size: data.byteLength,
      };
    } catch {
      return { type: vscode.FileType.Directory, ctime: now, mtime: now, size: 0 };
    }
  }

  async readDirectory(uri: vscode.Uri): Promise<[string, vscode.FileType][]> {
    const k = this.key(uri);
    let names: string[];
    try {
      names = await this.fs.readdir(k);
    } catch {
      throw vscode.FileSystemError.FileNotFound(uri);
    }
    const out: [string, vscode.FileType][] = [];
    for (const name of names) {
      // Hide .git noise in Explorer
      if (name === '.git') continue;
      const childKey = k ? `${k}/${name}` : name;
      try {
        await this.fs.readFile(childKey);
        out.push([name, vscode.FileType.File]);
      } catch {
        out.push([name, vscode.FileType.Directory]);
      }
    }
    return out;
  }

  async readFile(uri: vscode.Uri): Promise<Uint8Array> {
    try {
      return await this.fs.readFile(this.key(uri));
    } catch {
      throw vscode.FileSystemError.FileNotFound(uri);
    }
  }

  async writeFile(
    uri: vscode.Uri,
    content: Uint8Array,
    options: { create: boolean; overwrite: boolean },
  ): Promise<void> {
    const k = this.key(uri);
    const exists = await this.fs.exists(k);
    let isFile = false;
    if (exists) {
      try {
        await this.fs.readFile(k);
        isFile = true;
      } catch {
        throw vscode.FileSystemError.FileIsADirectory(uri);
      }
    }
    if (!exists && !options.create) throw vscode.FileSystemError.FileNotFound(uri);
    if (isFile && !options.overwrite) throw vscode.FileSystemError.FileExists(uri);
    await this.fs.writeFile(k, content);
    this.emitter.fire([
      {
        type: exists ? vscode.FileChangeType.Changed : vscode.FileChangeType.Created,
        uri,
      },
    ]);
  }

  async createDirectory(uri: vscode.Uri): Promise<void> {
    const k = this.key(uri);
    if (await this.fs.exists(k)) {
      try {
        await this.fs.readFile(k);
        throw vscode.FileSystemError.FileNotADirectory(uri);
      } catch (e) {
        if (e instanceof vscode.FileSystemError) throw e;
        // already a dir
        return;
      }
    }
    await this.fs.mkdir(k);
    this.emitter.fire([{ type: vscode.FileChangeType.Created, uri }]);
  }

  async delete(uri: vscode.Uri, options: { recursive: boolean }): Promise<void> {
    const k = this.key(uri);
    if (!options.recursive) {
      const kids = await this.fs.readdir(k).catch(() => [] as string[]);
      if (kids.length) throw vscode.FileSystemError.NoPermissions(uri);
    }
    await this.fs.rm(k, { recursive: true });
    this.emitter.fire([{ type: vscode.FileChangeType.Deleted, uri }]);
  }

  async rename(
    oldUri: vscode.Uri,
    newUri: vscode.Uri,
    options: { overwrite: boolean },
  ): Promise<void> {
    const data = await this.readFile(oldUri);
    await this.writeFile(newUri, data, { create: true, overwrite: options.overwrite });
    await this.delete(oldUri, { recursive: true });
  }

  /** Whether this workspace path has any files (excluding meta-only empty). */
  async hasContent(workspaceId: string): Promise<boolean> {
    const files = (await this.fs.listFiles?.(`workspace/${workspaceId}`)) ?? [];
    return files.some(
      (f) =>
        !f.endsWith('.zcode-workspace.json') &&
        !f.includes('/.git/') &&
        f !== `workspace/${workspaceId}/.zcode-workspace.json`,
    );
  }

  async seedIfEmpty(workspaceId: string): Promise<void> {
    if (await this.hasContent(workspaceId)) return;
    const root = `workspace/${workspaceId}`;
    await this.fs.mkdir(root);
    await this.fs.writeFile(
      `${root}/README.md`,
      `# ZCode workspace\n\nVirtual FS: **${this.storageLabel}** (scheme \`zcode-opfs\`).\n\nClone repos at [/debug/](/debug/) (DEV) then open \`/?workspace=${workspaceId}\`.\n`,
    );
    await this.fs.writeFile(
      `${root}/hello.ts`,
      `export function hello(name: string): string {\n  return \`Hello, \${name}!\`;\n}\n\nconsole.log(hello('ZCode'));\n`,
    );
    // Browser WASM runtimes (zcode-runtime-*) — dogfood without remote
    await this.fs.writeFile(
      `${root}/hello.js`,
      `// ZCode: Run File — WebContainer (multi-file) or worker fallback\nconsole.log('Hello from browser JS');\nconsole.log(2 + 2);\n`,
    );
    await this.fs.writeFile(
      `${root}/hello.py`,
      `# ZCode: Run File (Pyodide) — no remote server required\nprint("Hello from browser Python")\nprint(2 + 2)\n`,
    );
    // Minimal package for WebContainer npm dogfood (no deps)
    await this.fs.writeFile(
      `${root}/package.json`,
      JSON.stringify(
        {
          name: 'zcode-workspace',
          private: true,
          type: 'module',
          scripts: {
            start: 'node hello.js',
            test: 'node hello.js',
          },
        },
        null,
        2,
      ) + '\n',
    );
    await this.fs.writeFile(
      `${root}/.zcode-workspace.json`,
      JSON.stringify({
        id: workspaceId,
        name: workspaceId,
        createdAt: new Date().toISOString(),
      }),
    );
  }
}

/** @deprecated name kept for imports; same as IdbFileSystemProvider */
export { IdbFileSystemProvider as ZcodeFileSystemProvider };
