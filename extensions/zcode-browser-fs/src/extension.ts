/**
 * Web extension: virtual FileSystemProvider for ZCode browser workspaces.
 * Registers scheme `zcode-opfs` so VS Code Web can open a folder without a remote FS.
 */
import type * as vscode from 'vscode';

declare const vscode: typeof import('vscode');

const SCHEME = 'zcode-opfs';

class MemoryEntry {
  constructor(
    public type: vscode.FileType,
    public ctime: number,
    public mtime: number,
    public size: number,
    public data?: Uint8Array,
  ) {}
}

class MemoryFileSystemProvider implements vscode.FileSystemProvider {
  private readonly files = new Map<string, MemoryEntry>();
  private readonly emitter = new vscode.EventEmitter<vscode.FileChangeEvent[]>();
  readonly onDidChangeFile = this.emitter.event;

  constructor() {
    const now = Date.now();
    this.files.set('', new MemoryEntry(vscode.FileType.Directory, now, now, 0));
  }

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

  stat(uri: vscode.Uri): vscode.FileStat {
    const k = this.key(uri);
    const e = this.files.get(k);
    if (e) {
      return { type: e.type, ctime: e.ctime, mtime: e.mtime, size: e.size };
    }
    // Implicit directory if children exist
    for (const key of this.files.keys()) {
      if (key.startsWith(k + '/')) {
        const now = Date.now();
        return { type: vscode.FileType.Directory, ctime: now, mtime: now, size: 0 };
      }
    }
    throw vscode.FileSystemError.FileNotFound(uri);
  }

  readDirectory(uri: vscode.Uri): [string, vscode.FileType][] {
    const prefix = this.key(uri);
    const base = prefix ? prefix + '/' : '';
    const names = new Map<string, vscode.FileType>();
    for (const k of this.files.keys()) {
      if (!k.startsWith(base) || k === prefix) continue;
      const rest = k.slice(base.length);
      const name = rest.split('/')[0]!;
      if (!name || names.has(name)) continue;
      const childKey = base + name;
      const child = this.files.get(childKey);
      if (child) {
        names.set(name, child.type);
      } else {
        names.set(name, vscode.FileType.Directory);
      }
    }
    return [...names.entries()];
  }

  readFile(uri: vscode.Uri): Uint8Array {
    const e = this.files.get(this.key(uri));
    if (!e || e.type !== vscode.FileType.File || !e.data) {
      throw vscode.FileSystemError.FileNotFound(uri);
    }
    return e.data;
  }

  writeFile(
    uri: vscode.Uri,
    content: Uint8Array,
    options: { create: boolean; overwrite: boolean },
  ): void {
    const k = this.key(uri);
    const existing = this.files.get(k);
    if (!existing && !options.create) throw vscode.FileSystemError.FileNotFound(uri);
    if (existing && existing.type === vscode.FileType.Directory) {
      throw vscode.FileSystemError.FileIsADirectory(uri);
    }
    if (existing && !options.overwrite) throw vscode.FileSystemError.FileExists(uri);
    this.ensureParent(k);
    const now = Date.now();
    this.files.set(
      k,
      new MemoryEntry(
        vscode.FileType.File,
        existing?.ctime ?? now,
        now,
        content.byteLength,
        content,
      ),
    );
    this.emitter.fire([
      {
        type: existing ? vscode.FileChangeType.Changed : vscode.FileChangeType.Created,
        uri,
      },
    ]);
  }

  createDirectory(uri: vscode.Uri): void {
    const k = this.key(uri);
    if (this.files.has(k) && this.files.get(k)!.type === vscode.FileType.File) {
      throw vscode.FileSystemError.FileNotADirectory(uri);
    }
    this.ensureParent(k);
    if (!this.files.has(k)) {
      const now = Date.now();
      this.files.set(k, new MemoryEntry(vscode.FileType.Directory, now, now, 0));
      this.emitter.fire([{ type: vscode.FileChangeType.Created, uri }]);
    }
  }

  delete(uri: vscode.Uri, options: { recursive: boolean }): void {
    const k = this.key(uri);
    const children = [...this.files.keys()].filter((key) => key.startsWith(k + '/'));
    if (children.length && !options.recursive) {
      throw vscode.FileSystemError.NoPermissions(uri);
    }
    for (const key of [...this.files.keys()]) {
      if (key === k || key.startsWith(k + '/')) this.files.delete(key);
    }
    this.emitter.fire([{ type: vscode.FileChangeType.Deleted, uri }]);
  }

  rename(oldUri: vscode.Uri, newUri: vscode.Uri, options: { overwrite: boolean }): void {
    const data = this.readFile(oldUri);
    this.writeFile(newUri, data, { create: true, overwrite: options.overwrite });
    this.delete(oldUri, { recursive: true });
  }

  private ensureParent(k: string): void {
    if (!k.includes('/')) return;
    const parent = k.slice(0, k.lastIndexOf('/'));
    if (!parent) return;
    if (!this.files.has(parent)) {
      this.ensureParent(parent);
      const now = Date.now();
      this.files.set(parent, new MemoryEntry(vscode.FileType.Directory, now, now, 0));
    }
  }
}

function enc(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

async function seedWorkspace(root: vscode.Uri): Promise<void> {
  try {
    await vscode.workspace.fs.createDirectory(root);
  } catch {
    /* exists */
  }
  const readme = vscode.Uri.joinPath(root, 'README.md');
  const hello = vscode.Uri.joinPath(root, 'hello.ts');
  try {
    await vscode.workspace.fs.stat(readme);
  } catch {
    await vscode.workspace.fs.writeFile(
      readme,
      enc(
        `# ZCode workspace\n\nThis folder is a **virtual** filesystem (\`zcode-opfs\`) inside VS Code Web.\n\n- Edit files freely (in-memory for this extension)\n- Use the [browser SPA](/) for git clone via isomorphic-git\n- Remote mode: open \`/ide/?mode=remote&authority=host:port\` when REH is running\n`,
      ),
    );
  }
  try {
    await vscode.workspace.fs.stat(hello);
  } catch {
    await vscode.workspace.fs.writeFile(
      hello,
      enc(`export function hello(name: string): string {\n  return \`Hello, \${name}!\`;\n}\n\nconsole.log(hello('ZCode'));\n`),
    );
  }
}

export function activate(context: vscode.ExtensionContext): void {
  const provider = new MemoryFileSystemProvider();
  context.subscriptions.push(
    vscode.workspace.registerFileSystemProvider(SCHEME, provider, {
      isCaseSensitive: true,
      isReadonly: false,
    }),
  );

  // Seed default workspace so Explorer is not empty
  const defaultRoot = vscode.Uri.from({ scheme: SCHEME, path: '/workspace/default' });
  void seedWorkspace(defaultRoot);

  context.subscriptions.push(
    vscode.commands.registerCommand('zcode.fs.openWorkspace', async () => {
      await seedWorkspace(defaultRoot);
      await vscode.commands.executeCommand('vscode.openFolder', defaultRoot, {
        forceReuseWindow: true,
      });
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('zcode.fs.seedSample', async () => {
      const folder = vscode.workspace.workspaceFolders?.[0]?.uri;
      if (folder?.scheme === SCHEME) {
        await seedWorkspace(folder);
        void vscode.window.showInformationMessage('ZCode sample files written.');
      }
    }),
  );
}

export function deactivate(): void {
  /* no-op */
}
