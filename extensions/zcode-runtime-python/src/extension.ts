/**
 * Browser Python via Pyodide (WB1). Loads WASM from configured CDN indexURL.
 */
import * as vscode from 'vscode';

interface PyodideInterface {
  runPythonAsync(code: string): Promise<unknown>;
  setStdout(opts: { batched: (s: string) => void }): void;
  setStderr(opts: { batched: (s: string) => void }): void;
}

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

async function loadPyodideScript(indexURL: string): Promise<void> {
  const g = globalThis as { loadPyodide?: (opts: { indexURL: string }) => Promise<PyodideInterface> };
  if (typeof g.loadPyodide === 'function') return;

  const base = indexURL.endsWith('/') ? indexURL : `${indexURL}/`;
  await new Promise<void>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = `${base}pyodide.js`;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(`Failed to load Pyodide from ${base}pyodide.js`));
    document.head.appendChild(script);
  });
}

function createPythonBackend(): ExecutionBackend {
  let pyodide: PyodideInterface | null = null;
  let loading: Promise<void> | null = null;

  async function ensure(): Promise<PyodideInterface> {
    if (pyodide) return pyodide;
    if (!loading) {
      loading = (async () => {
        const indexURL = vscode.workspace
          .getConfiguration('zcode.execution')
          .get<string>('pyodideIndexUrl', 'https://cdn.jsdelivr.net/pyodide/v0.27.5/full/');
        await loadPyodideScript(indexURL);
        const load = (globalThis as { loadPyodide: (o: { indexURL: string }) => Promise<PyodideInterface> })
          .loadPyodide;
        pyodide = await load({ indexURL: indexURL.endsWith('/') ? indexURL : `${indexURL}/` });
      })();
    }
    await loading;
    if (!pyodide) throw new Error('Pyodide failed to initialize');
    return pyodide;
  }

  return {
    id: 'browser-python',
    info: {
      id: 'browser-python',
      label: 'Python (browser / Pyodide)',
      languages: ['python'],
      requiresNetwork: true,
      requiresRemote: false,
    },
    async startSession() {
      await ensure();
    },
    async run(opts) {
      const py = await ensure();
      let stdout = '';
      let stderr = '';
      py.setStdout({
        batched: (s) => {
          stdout += s;
          opts.onStdout?.(s.endsWith('\n') ? s : `${s}\n`);
        },
      });
      py.setStderr({
        batched: (s) => {
          stderr += s;
          opts.onStderr?.(s.endsWith('\n') ? s : `${s}\n`);
        },
      });
      try {
        if (opts.signal?.aborted) {
          return { exitCode: 130, streamed: true };
        }
        await py.runPythonAsync(opts.code);
        return { exitCode: 0, streamed: true };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        opts.onStderr?.(`${msg}\n`);
        return { exitCode: 1, streamed: true };
      } finally {
        void stdout;
        void stderr;
      }
    },
    dispose() {
      pyodide = null;
      loading = null;
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
  throw new Error('zcode-runtime-core not available (globalThis.zcodeRuntime)');
}

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const backend = createPythonBackend();
  try {
    const api = await waitForRuntime();
    api.register(backend);
  } catch (err) {
    console.warn('[zcode-runtime-python]', err);
    void vscode.window.showWarningMessage(
      'ZCode Python runtime: core registry missing. Is zcode-runtime-core installed?',
    );
  }

  context.subscriptions.push(
    vscode.commands.registerCommand('zcode.runtime.python.repl', async () => {
      try {
        await backend.startSession?.();
        void vscode.window.showInformationMessage(
          'Pyodide ready. Use “ZCode: Run File” on a .py file, or Run Selection.',
        );
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        void vscode.window.showErrorMessage(`Pyodide: ${msg}`);
      }
    }),
    {
      dispose: () => {
        const api = (globalThis as { zcodeRuntime?: ZcodeRuntimeApi }).zcodeRuntime;
        api?.unregister(backend.id);
        backend.dispose();
      },
    },
  );
}

export function deactivate(): void {
  /* disposed via subscriptions */
}
