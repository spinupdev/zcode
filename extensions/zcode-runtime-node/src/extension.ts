/**
 * Browser Node/JS execution (WB2+):
 * 1. WebContainers — multi-file OPFS mount + npm install/run
 * 2. Worker fallback for simple console demos
 */
import * as vscode from 'vscode';
import {
  buildFileSystemTree,
  hasPackageJson,
  relativeWorkspacePath,
  workspaceFolderFor,
  type FileSystemTree,
} from './fs-tree.js';

type WcTree = FileSystemTree;

interface ExecutionBackend {
  readonly id: string;
  readonly info: {
    id: string;
    label: string;
    languages: string[];
    requiresNetwork: boolean;
    requiresRemote: boolean;
  };
  startSession?(): Promise<void>;
  run(opts: {
    code: string;
    languageId: string;
    uri?: string;
    path?: string;
    onStdout?: (c: string) => void;
    onStderr?: (c: string) => void;
    signal?: AbortSignal;
  }): Promise<{ exitCode: number; streamed?: boolean }>;
  dispose(): void;
}

interface ZcodeRuntimeApi {
  register(backend: ExecutionBackend): void;
  unregister(id: string): void;
}

type NodeEngine = 'auto' | 'webcontainer' | 'worker';

interface WebContainerInstance {
  mount(tree: WcTree): Promise<void>;
  spawn(
    command: string,
    args?: string[],
    options?: { cwd?: string; output?: boolean },
  ): Promise<{
    output: ReadableStream<string>;
    exit: Promise<number>;
    kill(): void;
  }>;
  fs?: {
    writeFile(path: string, data: string): Promise<void>;
  };
  teardown?(): Promise<void>;
}

interface WebContainerApi {
  boot(opts?: { coep?: 'require-corp' | 'credentialless' | 'none' }): Promise<WebContainerInstance>;
}

function stripTs(code: string, languageId: string): string {
  if (!languageId.startsWith('typescript') && languageId !== 'typescriptreact') {
    return code;
  }
  return code
    .replace(/:\s*[A-Za-z0-9_<>[\]|&.,\s]+(?=[=;,)\n])/g, '')
    .replace(/\sas\s+[A-Za-z0-9_<>[\]|&.]+/g, '');
}

function preferredEngine(): NodeEngine {
  const v = vscode.workspace
    .getConfiguration('zcode.execution')
    .get<string>('nodeEngine', 'auto');
  if (v === 'webcontainer' || v === 'worker' || v === 'auto') return v;
  return 'auto';
}

function autoNpmInstall(): boolean {
  return vscode.workspace
    .getConfiguration('zcode.execution')
    .get<boolean>('webcontainerAutoNpmInstall', true);
}

async function loadWebContainerApi(): Promise<WebContainerApi> {
  const url =
    vscode.workspace
      .getConfiguration('zcode.execution')
      .get<string>(
        'webcontainerCdnUrl',
        'https://cdn.jsdelivr.net/npm/@webcontainer/api@1.6.1/+esm',
      ) ?? 'https://cdn.jsdelivr.net/npm/@webcontainer/api@1.6.1/+esm';
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mod = (await import(/* webpackIgnore: true */ url as any)) as {
    WebContainer?: { boot: WebContainerApi['boot'] };
    default?: { boot: WebContainerApi['boot'] } | { WebContainer: { boot: WebContainerApi['boot'] } };
  };
  const WC =
    mod.WebContainer ??
    (mod.default && 'boot' in mod.default ? mod.default : undefined) ??
    (mod.default && 'WebContainer' in mod.default
      ? (mod.default as { WebContainer: { boot: WebContainerApi['boot'] } }).WebContainer
      : undefined);
  if (!WC || typeof WC.boot !== 'function') {
    throw new Error('WebContainer API failed to load from CDN');
  }
  return WC as WebContainerApi;
}

function createWorkerBlobUrl(): string {
  const src = `
self.onmessage = async (ev) => {
  const { code, id } = ev.data || {};
  const logs = [];
  const errs = [];
  const origLog = console.log;
  const origErr = console.error;
  const origWarn = console.warn;
  console.log = (...args) => { logs.push(args.map(String).join(' ')); };
  console.error = (...args) => { errs.push(args.map(String).join(' ')); };
  console.warn = (...args) => { errs.push(args.map(String).join(' ')); };
  try {
    const AsyncFunction = Object.getPrototypeOf(async function(){}).constructor;
    const fn = new AsyncFunction(code);
    const result = await fn();
    if (result !== undefined) logs.push(String(result));
    self.postMessage({ id, ok: true, logs, errs });
  } catch (e) {
    errs.push(e && e.stack ? e.stack : String(e));
    self.postMessage({ id, ok: false, logs, errs });
  } finally {
    console.log = origLog;
    console.error = origErr;
    console.warn = origWarn;
  }
};
`;
  return URL.createObjectURL(new Blob([src], { type: 'application/javascript' }));
}

async function runInWorker(
  blobUrl: string,
  code: string,
  opts: {
    onStdout?: (c: string) => void;
    onStderr?: (c: string) => void;
    signal?: AbortSignal;
  },
): Promise<{ exitCode: number; streamed?: boolean }> {
  const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return await new Promise((resolve) => {
    const worker = new Worker(blobUrl);
    const onAbort = () => {
      worker.terminate();
      resolve({ exitCode: 130, streamed: true });
    };
    opts.signal?.addEventListener('abort', onAbort, { once: true });
    worker.onmessage = (ev: MessageEvent) => {
      opts.signal?.removeEventListener('abort', onAbort);
      const data = ev.data as { id: string; ok: boolean; logs: string[]; errs: string[] };
      if (data.id !== id) return;
      for (const line of data.logs ?? []) opts.onStdout?.(`${line}\n`);
      for (const line of data.errs ?? []) opts.onStderr?.(`${line}\n`);
      worker.terminate();
      resolve({ exitCode: data.ok ? 0 : 1, streamed: true });
    };
    worker.onerror = (err) => {
      opts.signal?.removeEventListener('abort', onAbort);
      opts.onStderr?.(`${err.message}\n`);
      worker.terminate();
      resolve({ exitCode: 1, streamed: true });
    };
    worker.postMessage({ id, code });
  });
}

async function readStream(
  stream: ReadableStream<string>,
  onChunk: (s: string) => void,
  signal?: AbortSignal,
): Promise<void> {
  const reader = stream.getReader();
  try {
    while (true) {
      if (signal?.aborted) {
        await reader.cancel();
        break;
      }
      const { done, value } = await reader.read();
      if (done) break;
      if (value) onChunk(value);
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {
      /* ignore */
    }
  }
}

async function spawnAndCollect(
  container: WebContainerInstance,
  command: string,
  args: string[],
  opts: {
    onStdout?: (c: string) => void;
    onStderr?: (c: string) => void;
    signal?: AbortSignal;
  },
): Promise<number> {
  const proc = await container.spawn(command, args);
  const onAbort = () => {
    try {
      proc.kill();
    } catch {
      /* ignore */
    }
  };
  opts.signal?.addEventListener('abort', onAbort, { once: true });
  try {
    await readStream(proc.output, (chunk) => opts.onStdout?.(chunk), opts.signal);
    return await proc.exit;
  } finally {
    opts.signal?.removeEventListener('abort', onAbort);
  }
}

/** Shared WC session for Run File + npm commands */
class WebContainerSession {
  private wc: WebContainerInstance | null = null;
  private bootPromise: Promise<void> | null = null;
  private lastFolderKey: string | null = null;
  private npmInstalledFor: string | null = null;
  private blobUrl: string | null = null;

  async ensureWorker(): Promise<string> {
    if (!this.blobUrl) this.blobUrl = createWorkerBlobUrl();
    return this.blobUrl;
  }

  async ensureContainer(): Promise<WebContainerInstance> {
    if (this.wc) return this.wc;
    if (!this.bootPromise) {
      this.bootPromise = (async () => {
        const api = await loadWebContainerApi();
        const coep = (globalThis as { crossOriginIsolated?: boolean }).crossOriginIsolated
          ? 'require-corp'
          : 'none';
        this.wc = await api.boot({ coep });
      })();
    }
    await this.bootPromise;
    if (!this.wc) throw new Error('WebContainer boot failed');
    return this.wc;
  }

  /**
   * Mount workspace folder tree. Re-mounts when folder changes.
   * Writes the active file contents on top so unsaved disk state matches editor (caller should save).
   */
  async mountWorkspace(
    folder: vscode.WorkspaceFolder,
    activeRelPath: string | undefined,
    activeCode: string | undefined,
    log: (s: string) => void,
  ): Promise<{ tree: WcTree; hadPackageJson: boolean }> {
    const container = await this.ensureContainer();
    const key = folder.uri.toString();
    const built = await buildFileSystemTree(folder.uri);
    log(
      `[zcode] mounted ${built.fileCount} file(s) (${Math.round(built.bytes / 1024)} KiB)` +
        (built.skipped.length ? `; skipped ${built.skipped.length}` : '') +
        '\n',
    );
    if (activeRelPath && activeCode != null) {
      // Ensure active editor content is in the tree (overwrite mount snapshot)
      setTreeFile(built.tree, activeRelPath, activeCode);
    }
    await container.mount(built.tree);
    this.lastFolderKey = key;
    return { tree: built.tree, hadPackageJson: hasPackageJson(built.tree) };
  }

  async npmInstall(
    folderKey: string,
    opts: {
      onStdout?: (c: string) => void;
      onStderr?: (c: string) => void;
      signal?: AbortSignal;
      force?: boolean;
    },
  ): Promise<number> {
    if (!opts.force && this.npmInstalledFor === folderKey) {
      opts.onStdout?.('[zcode] npm install skipped (already ran this session)\n');
      return 0;
    }
    const container = await this.ensureContainer();
    opts.onStdout?.('$ npm install\n');
    const code = await spawnAndCollect(container, 'npm', ['install'], opts);
    if (code === 0) this.npmInstalledFor = folderKey;
    return code;
  }

  async runNode(
    relPath: string,
    opts: {
      onStdout?: (c: string) => void;
      onStderr?: (c: string) => void;
      signal?: AbortSignal;
    },
  ): Promise<number> {
    const container = await this.ensureContainer();
    opts.onStdout?.(`$ node ${relPath}\n`);
    return spawnAndCollect(container, 'node', [relPath], opts);
  }

  async npmRun(
    script: string,
    opts: {
      onStdout?: (c: string) => void;
      onStderr?: (c: string) => void;
      signal?: AbortSignal;
    },
  ): Promise<number> {
    const container = await this.ensureContainer();
    opts.onStdout?.(`$ npm run ${script}\n`);
    return spawnAndCollect(container, 'npm', ['run', script], opts);
  }

  resetMountCache(): void {
    this.lastFolderKey = null;
    this.npmInstalledFor = null;
  }

  dispose(): void {
    if (this.blobUrl) {
      URL.revokeObjectURL(this.blobUrl);
      this.blobUrl = null;
    }
    if (this.wc?.teardown) void this.wc.teardown();
    this.wc = null;
    this.bootPromise = null;
    this.lastFolderKey = null;
    this.npmInstalledFor = null;
  }
}

function setTreeFile(tree: WcTree, relPath: string, contents: string): void {
  const parts = relPath.split('/').filter(Boolean);
  if (parts.length === 0) return;
  let cur: WcTree = tree;
  for (let i = 0; i < parts.length - 1; i++) {
    const p = parts[i]!;
    const existing = cur[p];
    if (existing && 'directory' in existing) {
      cur = existing.directory;
    } else {
      const dir = { directory: {} as WcTree };
      cur[p] = dir;
      cur = dir.directory;
    }
  }
  cur[parts[parts.length - 1]!] = { file: { contents } };
}

function createNodeBackend(session: WebContainerSession): ExecutionBackend {
  return {
    id: 'browser-node',
    info: {
      id: 'browser-node',
      label: 'Node / JavaScript (browser)',
      languages: ['javascript', 'typescript', 'javascriptreact', 'typescriptreact'],
      requiresNetwork: true,
      requiresRemote: false,
    },
    async startSession() {
      const engine = preferredEngine();
      if (engine === 'worker') {
        await session.ensureWorker();
        return;
      }
      try {
        await session.ensureContainer();
      } catch {
        if (engine === 'webcontainer') throw new Error('WebContainer boot failed');
        await session.ensureWorker();
      }
    },
    async run(opts) {
      const code = stripTs(opts.code, opts.languageId);
      const engine = preferredEngine();

      const tryWorker = async () => {
        const url = await session.ensureWorker();
        opts.onStdout?.('[zcode] engine=worker\n');
        return runInWorker(url, code, opts);
      };

      const tryWc = async () => {
        opts.onStdout?.('[zcode] engine=webcontainer\n');
        const uri = opts.uri ? vscode.Uri.parse(opts.uri) : vscode.window.activeTextEditor?.document.uri;
        const folder = workspaceFolderFor(uri);
        if (!folder) {
          // No workspace — single-file mount
          const container = await session.ensureContainer();
          await container.mount({ 'main.mjs': { file: { contents: code } } });
          const exitCode = await spawnAndCollect(container, 'node', ['main.mjs'], opts);
          return { exitCode, streamed: true as const };
        }

        const rel =
          uri != null
            ? relativeWorkspacePath(uri, folder) || 'main.mjs'
            : 'main.mjs';
        // Prefer .mjs for pure ESM if .js; keep original relative path when possible
        const entryRel = rel || 'main.mjs';

        const { hadPackageJson } = await session.mountWorkspace(
          folder,
          entryRel,
          code,
          (s) => opts.onStdout?.(s),
        );

        if (hadPackageJson && autoNpmInstall()) {
          const installCode = await session.npmInstall(folder.uri.toString(), {
            onStdout: opts.onStdout,
            onStderr: opts.onStderr,
            signal: opts.signal,
          });
          if (installCode !== 0) {
            opts.onStderr?.(`[zcode] npm install exited ${installCode}\n`);
            // Continue — file may not need deps
          }
        }

        // Write entry again after install in case mount was only tree
        const container = await session.ensureContainer();
        if (container.fs?.writeFile) {
          try {
            await container.fs.writeFile(entryRel, code);
          } catch {
            /* mount already has file */
          }
        }

        const exitCode = await session.runNode(entryRel, opts);
        return { exitCode, streamed: true as const };
      };

      if (engine === 'worker') return tryWorker();
      if (engine === 'webcontainer') return tryWc();

      try {
        return await tryWc();
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        opts.onStderr?.(`[zcode] WebContainer unavailable (${msg}); falling back to worker\n`);
        session.resetMountCache();
        return tryWorker();
      }
    },
    dispose() {
      /* session disposed by extension */
    },
  };
}

async function waitForRuntime(maxMs = 15000): Promise<ZcodeRuntimeApi> {
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    const api = (globalThis as { zcodeRuntime?: ZcodeRuntimeApi }).zcodeRuntime;
    if (api) return api;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error('zcode-runtime-core not available');
}

function outputChannel(): vscode.OutputChannel {
  return vscode.window.createOutputChannel('ZCode Node', { log: true });
}

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const session = new WebContainerSession();
  const backend = createNodeBackend(session);

  try {
    const api = await waitForRuntime();
    api.register(backend);
  } catch (err) {
    console.warn('[zcode-runtime-node]', err);
  }

  const runWithProgress = async (
    title: string,
    fn: (log: (s: string) => void) => Promise<number>,
  ) => {
    const ch = outputChannel();
    ch.show(true);
    ch.appendLine(`$ ${title}`);
    try {
      const code = await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title, cancellable: false },
        async () =>
          fn((s) => {
            ch.append(s);
          }),
      );
      ch.appendLine(`--- exit ${code}`);
      if (code !== 0) {
        void vscode.window.showWarningMessage(`${title} exited ${code}`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      ch.appendLine(`error: ${msg}`);
      void vscode.window.showErrorMessage(msg);
    }
  };

  context.subscriptions.push(
    {
      dispose: () => {
        const api = (globalThis as { zcodeRuntime?: ZcodeRuntimeApi }).zcodeRuntime;
        api?.unregister(backend.id);
        session.dispose();
      },
    },
    vscode.commands.registerCommand('zcode.runtime.node.npmInstall', async () => {
      const folder = workspaceFolderFor(vscode.window.activeTextEditor?.document.uri);
      if (!folder) {
        void vscode.window.showErrorMessage('No workspace folder open');
        return;
      }
      await runWithProgress('ZCode: npm install (WebContainer)', async (log) => {
        log('[zcode] engine=webcontainer\n');
        const { hadPackageJson } = await session.mountWorkspace(folder, undefined, undefined, log);
        if (!hadPackageJson) {
          log('No package.json in workspace\n');
          return 1;
        }
        return session.npmInstall(folder.uri.toString(), {
          onStdout: log,
          onStderr: log,
          force: true,
        });
      });
    }),
    vscode.commands.registerCommand('zcode.runtime.node.npmRun', async () => {
      const folder = workspaceFolderFor(vscode.window.activeTextEditor?.document.uri);
      if (!folder) {
        void vscode.window.showErrorMessage('No workspace folder open');
        return;
      }
      const script = await vscode.window.showInputBox({
        title: 'npm run',
        prompt: 'Script name from package.json',
        value: 'start',
      });
      if (!script) return;
      await runWithProgress(`ZCode: npm run ${script}`, async (log) => {
        log('[zcode] engine=webcontainer\n');
        const { hadPackageJson } = await session.mountWorkspace(folder, undefined, undefined, log);
        if (!hadPackageJson) {
          log('No package.json in workspace\n');
          return 1;
        }
        if (autoNpmInstall()) {
          await session.npmInstall(folder.uri.toString(), { onStdout: log, onStderr: log });
        }
        return session.npmRun(script, { onStdout: log, onStderr: log });
      });
    }),
    vscode.commands.registerCommand('zcode.runtime.node.mountStatus', async () => {
      const folder = workspaceFolderFor(vscode.window.activeTextEditor?.document.uri);
      if (!folder) {
        void vscode.window.showInformationMessage('No workspace folder');
        return;
      }
      const built = await buildFileSystemTree(folder.uri);
      void vscode.window.showInformationMessage(
        `WebContainer mount would include ${built.fileCount} files (${Math.round(built.bytes / 1024)} KiB)` +
          (built.skipped.length ? `, skip ${built.skipped.length}` : '') +
          (hasPackageJson(built.tree) ? ', package.json yes' : ''),
      );
    }),
  );
}

export function deactivate(): void {
  /* via subscriptions */
}
