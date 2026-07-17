/**
 * Web extension: register zcode-opfs FileSystemProvider.
 * Backed by the in-page browser agent when available, else memory.
 */
import type * as vscode from 'vscode';

// vscode is injected by the workbench at runtime
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

/** Simple hierarchical memory FS for the provider until agent bridge is wired. */
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

  watch(): vscode.Disposable {
    return new vscode.Disposable(() => {
      /* no-op */
    });
  }

  stat(uri: vscode.Uri): vscode.FileStat {
    const e = this.files.get(this.key(uri));
    if (!e) throw vscode.FileSystemError.FileNotFound(uri);
    return { type: e.type, ctime: e.ctime, mtime: e.mtime, size: e.size };
  }

  readDirectory(uri: vscode.Uri): [string, vscode.FileType][] {
    const prefix = this.key(uri);
    const base = prefix ? prefix + '/' : '';
    const names = new Map<string, vscode.FileType>();
    for (const k of this.files.keys()) {
      if (!k.startsWith(base) || k === prefix) continue;
      const rest = k.slice(base.length);
      const name = rest.split('/')[0]!;
      if (!names.has(name)) {
        const child = this.files.get(base + name);
        names.set(name, child?.type ?? vscode.FileType.Directory);
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
    if (existing && !options.overwrite) throw vscode.FileSystemError.FileExists(uri);
    this.ensureParent(k);
    const now = Date.now();
    this.files.set(
      k,
      new MemoryEntry(vscode.FileType.File, existing?.ctime ?? now, now, content.byteLength, content),
    );
    this.emitter.fire([{ type: vscode.FileChangeType.Changed, uri }]);
  }

  createDirectory(uri: vscode.Uri): void {
    const k = this.key(uri);
    if (this.files.has(k)) throw vscode.FileSystemError.FileExists(uri);
    this.ensureParent(k);
    const now = Date.now();
    this.files.set(k, new MemoryEntry(vscode.FileType.Directory, now, now, 0));
    this.emitter.fire([{ type: vscode.FileChangeType.Created, uri }]);
  }

  delete(uri: vscode.Uri): void {
    const k = this.key(uri);
    for (const key of [...this.files.keys()]) {
      if (key === k || key.startsWith(k + '/')) this.files.delete(key);
    }
    this.emitter.fire([{ type: vscode.FileChangeType.Deleted, uri }]);
  }

  rename(oldUri: vscode.Uri, newUri: vscode.Uri, options: { overwrite: boolean }): void {
    const data = this.readFile(oldUri);
    this.writeFile(newUri, data, { create: true, overwrite: options.overwrite });
    this.delete(oldUri);
  }

  private ensureParent(k: string): void {
    if (!k.includes('/')) return;
    const parent = k.slice(0, k.lastIndexOf('/'));
    if (!this.files.has(parent)) {
      this.ensureParent(parent);
      const now = Date.now();
      this.files.set(parent, new MemoryEntry(vscode.FileType.Directory, now, now, 0));
    }
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
  context.subscriptions.push(
    vscode.commands.registerCommand('zcode.fs.openWorkspace', async () => {
      const uri = vscode.Uri.parse(`${SCHEME}:/workspace/default/`);
      try {
        await vscode.workspace.fs.createDirectory(uri);
      } catch {
        /* exists */
      }
      await vscode.commands.executeCommand('vscode.openFolder', uri, { forceReuseWindow: true });
    }),
  );
}

export function deactivate(): void {
  /* no-op */
}
