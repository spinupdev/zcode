/**
 * Browser Node/JS execution (WB2+):
 * 1. WebContainers (real Node) when engine allows and boot succeeds
 * 2. Lightweight Worker fallback (console.log demos)
 */
import * as vscode from 'vscode';

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

/** Minimal WebContainer surface we use */
interface WebContainerInstance {
  mount(tree: Record<string, { file: { contents: string } }>): Promise<void>;
  spawn(command: string, args: string[]): Promise<{
    output: ReadableStream<string>;
    exit: Promise<number>;
    kill(): void;
  }>;
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

async function loadWebContainerApi(): Promise<WebContainerApi> {
  // Dynamic ESM from CDN — avoids broken worker paths inside esbuild bundle.
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
  const WC = mod.WebContainer
    ?? (mod.default && 'boot' in mod.default ? mod.default : undefined)
    ?? (mod.default && 'WebContainer' in mod.default
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

function createNodeBackend(): ExecutionBackend {
  let blobUrl: string | null = null;
  let wc: WebContainerInstance | null = null;
  let wcMode: 'webcontainer' | 'worker' | 'unknown' = 'unknown';
  let bootPromise: Promise<void> | null = null;

  async function ensureWorker(): Promise<string> {
    if (!blobUrl) blobUrl = createWorkerBlobUrl();
    wcMode = 'worker';
    return blobUrl;
  }

  async function ensureWebContainer(): Promise<WebContainerInstance> {
    if (wc) return wc;
    if (!bootPromise) {
      bootPromise = (async () => {
        const api = await loadWebContainerApi();
        // credentialless/none reduce need for full COI; still prefer COI when host sets headers
        const coep =
          (globalThis as { crossOriginIsolated?: boolean }).crossOriginIsolated
            ? 'require-corp'
            : 'none';
        wc = await api.boot({ coep });
        wcMode = 'webcontainer';
      })();
    }
    await bootPromise;
    if (!wc) throw new Error('WebContainer boot failed');
    return wc;
  }

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
        await ensureWorker();
        return;
      }
      if (engine === 'webcontainer') {
        await ensureWebContainer();
        return;
      }
      // auto: try WC, fall back to worker
      try {
        await ensureWebContainer();
      } catch {
        await ensureWorker();
      }
    },
    async run(opts) {
      const code = stripTs(opts.code, opts.languageId);
      const engine = preferredEngine();

      const tryWc = async () => {
        const container = await ensureWebContainer();
        opts.onStdout?.('[zcode] engine=webcontainer\n');
        await container.mount({
          'main.mjs': { file: { contents: code } },
        });
        const proc = await container.spawn('node', ['main.mjs']);
        const onAbort = () => {
          try {
            proc.kill();
          } catch {
            /* ignore */
          }
        };
        opts.signal?.addEventListener('abort', onAbort, { once: true });
        try {
          await readStream(
            proc.output,
            (chunk) => {
              // WebContainer multiplexes stdout/stderr on output stream
              opts.onStdout?.(chunk);
            },
            opts.signal,
          );
          const exitCode = await proc.exit;
          return { exitCode, streamed: true as const };
        } finally {
          opts.signal?.removeEventListener('abort', onAbort);
        }
      };

      const tryWorker = async () => {
        const url = await ensureWorker();
        opts.onStdout?.('[zcode] engine=worker\n');
        return runInWorker(url, code, opts);
      };

      if (engine === 'worker') return tryWorker();
      if (engine === 'webcontainer') return tryWc();

      try {
        return await tryWc();
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        opts.onStderr?.(`[zcode] WebContainer unavailable (${msg}); falling back to worker\n`);
        // Reset failed boot so later auto tries can retry WC after COI enabled
        bootPromise = null;
        wc = null;
        return tryWorker();
      }
    },
    dispose() {
      if (blobUrl) {
        URL.revokeObjectURL(blobUrl);
        blobUrl = null;
      }
      if (wc?.teardown) {
        void wc.teardown();
      }
      wc = null;
      bootPromise = null;
      void wcMode;
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

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const backend = createNodeBackend();
  try {
    const api = await waitForRuntime();
    api.register(backend);
  } catch (err) {
    console.warn('[zcode-runtime-node]', err);
  }

  context.subscriptions.push({
    dispose: () => {
      const api = (globalThis as { zcodeRuntime?: ZcodeRuntimeApi }).zcodeRuntime;
      api?.unregister(backend.id);
      backend.dispose();
    },
  });
}

export function deactivate(): void {
  /* via subscriptions */
}
