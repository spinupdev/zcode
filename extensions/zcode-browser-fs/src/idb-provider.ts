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
    _options: { readonly recursive: boolean; readonly excludes: readonly string[] },
  ): vscode.Disposable {
    return new vscode.Disposable(() => {
      /* no-op */
    });
  }

  /** Force Explorer refresh after external clone/write (same FS backend). */
  notifyChanged(uri: vscode.Uri, type: vscode.FileChangeType = vscode.FileChangeType.Changed): void {
    this.emitter.fire([{ type, uri }]);
  }

  /**
   * Fire Created/Changed events for every file under a workspace root so Explorer
   * rebuilds its tree after isomorphic-git writes outside the provider API.
   */
  async notifyTree(workspaceId: string, rootUri: vscode.Uri): Promise<number> {
    const prefix = `workspace/${workspaceId}`;
    const files = (await this.fs.listFiles?.(prefix)) ?? [];
    const events: vscode.FileChangeEvent[] = [
      { type: vscode.FileChangeType.Changed, uri: rootUri },
    ];
    const seenDirs = new Set<string>();

    for (const full of files) {
      if (full.includes('/.git/') || full.endsWith('/.git')) continue;
      // full = workspace/<id>/path/to/file
      const rel = full.startsWith(prefix + '/') ? full.slice(prefix.length + 1) : '';
      if (!rel || rel === '.git') continue;

      // Parent dirs
      const parts = rel.split('/');
      let acc = '';
      for (let i = 0; i < parts.length - 1; i++) {
        acc = acc ? `${acc}/${parts[i]}` : parts[i]!;
        if (seenDirs.has(acc)) continue;
        seenDirs.add(acc);
        events.push({
          type: vscode.FileChangeType.Created,
          uri: vscode.Uri.joinPath(rootUri, ...acc.split('/')),
        });
      }
      events.push({
        type: vscode.FileChangeType.Created,
        uri: vscode.Uri.joinPath(rootUri, ...parts),
      });
    }

    // Batch in chunks — large repos can produce thousands of events
    const chunk = 200;
    for (let i = 0; i < events.length; i += chunk) {
      this.emitter.fire(events.slice(i, i + chunk));
    }
    return files.filter((f) => !f.includes('/.git/')).length;
  }

  /** Swap backing store (e.g. IDB → OPFS) without re-registering the provider. */
  setFs(fs: AgentFs, storageLabel?: string): void {
    this.fs = fs;
    if (storageLabel) this.storageLabel = storageLabel;
  }

  getFs(): AgentFs {
    return this.fs;
  }

  async stat(uri: vscode.Uri): Promise<vscode.FileStat> {
    const k = this.key(uri);
    const now = Date.now();
    if (!k) {
      return { type: vscode.FileType.Directory, ctime: now, mtime: now, size: 0 };
    }
    // Workspace roots must always look like directories even if mkdir is lazy
    if (/^workspace\/[^/]+$/.test(k)) {
      if (await this.fs.exists(k)) {
        return { type: vscode.FileType.Directory, ctime: now, mtime: now, size: 0 };
      }
      // Parent of files may exist only as implied path — check children
      const kids = await this.fs.readdir(k).catch(() => [] as string[]);
      if (kids.length > 0) {
        return { type: vscode.FileType.Directory, ctime: now, mtime: now, size: 0 };
      }
      const any = (await this.fs.listFiles?.(k)) ?? [];
      if (any.length > 0) {
        return { type: vscode.FileType.Directory, ctime: now, mtime: now, size: 0 };
      }
      throw vscode.FileSystemError.FileNotFound(uri);
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
      // Fallback: synthesize children from listFiles when readdir fails
      const all = (await this.fs.listFiles?.(k)) ?? [];
      if (!all.length) throw vscode.FileSystemError.FileNotFound(uri);
      const prefix = k ? k + '/' : '';
      const child = new Set<string>();
      for (const f of all) {
        if (!f.startsWith(prefix) && k) continue;
        const rest = k ? f.slice(prefix.length) : f;
        const name = rest.split('/')[0];
        if (name) child.add(name);
      }
      names = [...child].sort();
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

  /**
   * Files written by the optional demo seed (not auto-created on startup).
   * Used to detect/remove leftover dogfood samples from older builds.
   */
  static readonly SEED_REL_PATHS = [
    'README.md',
    'hello.ts',
    'hello.js',
    'hello.py',
    'package.json',
  ] as const;

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

  /** True if this workspace has a git clone (.git directory/files). */
  async hasGit(workspaceId: string): Promise<boolean> {
    const root = `workspace/${workspaceId}`;
    if (await this.fs.exists(`${root}/.git`)) return true;
    const files = (await this.fs.listFiles?.(root)) ?? [];
    return files.some((f) => f.includes('/.git/') || f.endsWith('/.git/HEAD') || f.includes('/.git/'));
  }

  /**
   * Ensure workspace root exists (empty folder). Does **not** write sample files.
   */
  async ensureWorkspaceRoot(workspaceId: string): Promise<void> {
    const root = `workspace/${workspaceId}`;
    await this.fs.mkdir(root);
    const meta = `${root}/.zcode-workspace.json`;
    if (!(await this.fs.exists(meta))) {
      await this.fs.writeFile(
        meta,
        JSON.stringify({
          id: workspaceId,
          name: workspaceId,
          createdAt: new Date().toISOString(),
        }),
      );
    }
  }

  /**
   * True when the tree is only leftover ZCode seed samples (no user/git content).
   */
  async isSeedOnlyWorkspace(workspaceId: string): Promise<boolean> {
    if (await this.hasGit(workspaceId)) return false;
    const root = `workspace/${workspaceId}`;
    const files = (await this.fs.listFiles?.(root)) ?? [];
    const rels = files
      .filter((f) => !f.endsWith('/.zcode-workspace.json') && f !== `${root}/.zcode-workspace.json`)
      .map((f) => (f.startsWith(root + '/') ? f.slice(root.length + 1) : f));
    if (rels.length === 0) return false;
    const seedSet = new Set<string>(IdbFileSystemProvider.SEED_REL_PATHS);
    return rels.every((r) => seedSet.has(r));
  }

  /** Remove dogfood hello.* samples if the workspace has no other content. */
  async clearSeedIfOnlySamples(workspaceId: string): Promise<boolean> {
    if (!(await this.isSeedOnlyWorkspace(workspaceId))) return false;
    const root = `workspace/${workspaceId}`;
    for (const rel of IdbFileSystemProvider.SEED_REL_PATHS) {
      try {
        await this.fs.rm(`${root}/${rel}`, { recursive: true });
      } catch {
        /* ignore */
      }
    }
    await this.ensureWorkspaceRoot(workspaceId);
    return true;
  }

  /**
   * Optional demo files (command palette only — never auto on startup).
   * @deprecated prefer explicit seedSample; kept for call-site compatibility
   */
  async seedIfEmpty(workspaceId: string): Promise<void> {
    await this.seedSample(workspaceId, { force: false });
  }

  /** Write demo hello.* / package.json for WASM runtime dogfood. */
  async seedSample(workspaceId: string, opts?: { force?: boolean }): Promise<void> {
    if (await this.hasGit(workspaceId)) return;
    if (!opts?.force && (await this.hasContent(workspaceId))) return;
    const root = `workspace/${workspaceId}`;
    await this.fs.mkdir(root);
    await this.fs.writeFile(
      `${root}/README.md`,
      `# ZCode workspace\n\nVirtual FS: **${this.storageLabel}** (scheme \`zcode-opfs\`).\n\nUse **ZCode: Open Repository…** to clone a git repo, or **Run File** on hello.js / hello.py.\n`,
    );
    await this.fs.writeFile(
      `${root}/hello.ts`,
      `export function hello(name: string): string {\n  return \`Hello, \${name}!\`;\n}\n\nconsole.log(hello('ZCode'));\n`,
    );
    await this.fs.writeFile(
      `${root}/hello.js`,
      `// ZCode: Run File — WebContainer (multi-file) or worker fallback\nconsole.log('Hello from browser JS');\nconsole.log(2 + 2);\n`,
    );
    await this.fs.writeFile(
      `${root}/hello.py`,
      `# ZCode: Run File (Pyodide) — no remote server required\nprint("Hello from browser Python")\nprint(2 + 2)\n`,
    );
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
