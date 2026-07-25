/**
 * Lightweight JS/TS run in a Worker (WB2 v1).
 * Not full Node — no require/fs/npm. Good enough for pure JS demos.
 * Full WebContainers / WASI can replace this backend later.
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

/** Strip simple TS-only syntax for the worker (types, as casts) — best-effort. */
function stripTs(code: string, languageId: string): string {
  if (!languageId.startsWith('typescript') && languageId !== 'typescriptreact') {
    return code;
  }
  // Very small subset: remove `as Type` and `: Type` on simple declarations — not a real TS compiler.
  return code
    .replace(/:\s*[A-Za-z0-9_<>[\]|&.,\s]+(?=[=;,)\n])/g, '')
    .replace(/\sas\s+[A-Za-z0-9_<>[\]|&.]+/g, '');
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
  const blob = new Blob([src], { type: 'application/javascript' });
  return URL.createObjectURL(blob);
}

function createNodeBackend(): ExecutionBackend {
  let blobUrl: string | null = null;

  return {
    id: 'browser-node',
    info: {
      id: 'browser-node',
      label: 'JavaScript (browser worker)',
      languages: ['javascript', 'typescript', 'javascriptreact', 'typescriptreact'],
      requiresNetwork: false,
      requiresRemote: false,
    },
    async startSession() {
      if (!blobUrl) blobUrl = createWorkerBlobUrl();
    },
    async run(opts) {
      if (!blobUrl) blobUrl = createWorkerBlobUrl();
      const code = stripTs(opts.code, opts.languageId);
      const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;

      return await new Promise((resolve) => {
        const worker = new Worker(blobUrl!);
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
    },
    dispose() {
      if (blobUrl) {
        URL.revokeObjectURL(blobUrl);
        blobUrl = null;
      }
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
