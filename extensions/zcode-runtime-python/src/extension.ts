/**
 * Browser Python via Pyodide (WB1 + Pseudoterminal REPL).
 * Loads WASM from configured CDN indexURL.
 */
import * as vscode from 'vscode';
import {
  createPyodideReplPty,
  openPyodideReplTerminal,
  type PyodideReplEngine,
} from './repl-pty.js';

interface PyodideInterface {
  runPythonAsync(code: string): Promise<unknown>;
  runPython(code: string): unknown;
  setStdout(opts: { batched: (s: string) => void }): void;
  setStderr(opts: { batched: (s: string) => void }): void;
  pyimport(name: string): {
    compile_command: (source: string, filename?: string, symbol?: string) => unknown;
  };
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
  openTerminal?(): void;
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

/** Shared Pyodide session used by Run File and the interactive REPL. */
class PyodideSession {
  private pyodide: PyodideInterface | null = null;
  private loading: Promise<PyodideInterface> | null = null;
  private codeopReady = false;

  async ensure(): Promise<PyodideInterface> {
    if (this.pyodide) return this.pyodide;
    if (!this.loading) {
      this.loading = (async () => {
        const indexURL = vscode.workspace
          .getConfiguration('zcode.execution')
          .get<string>('pyodideIndexUrl', 'https://cdn.jsdelivr.net/pyodide/v0.27.5/full/');
        await loadPyodideScript(indexURL);
        const load = (globalThis as unknown as {
          loadPyodide: (o: { indexURL: string }) => Promise<PyodideInterface>;
        }).loadPyodide;
        const py = await load({ indexURL: indexURL.endsWith('/') ? indexURL : `${indexURL}/` });
        this.pyodide = py;
        return py;
      })();
    }
    return this.loading;
  }

  private async ensureCodeop(py: PyodideInterface): Promise<void> {
    if (this.codeopReady) return;
    await py.runPythonAsync('import codeop');
    this.codeopReady = true;
  }

  asReplEngine(): PyodideReplEngine {
    return {
      checkComplete: async (source: string) => {
        const py = await this.ensure();
        await this.ensureCodeop(py);
        // Use Python to call codeop.compile_command; None => incomplete
        const escaped = JSON.stringify(source);
        const result = await py.runPythonAsync(
          `codeop.compile_command(${escaped}, "<stdin>", "single")`,
        );
        if (result === undefined || result === null) return 'incomplete';
        return 'complete';
      },
      run: async (code, io) => {
        const py = await this.ensure();
        py.setStdout({
          batched: (s) => io.stdout(s),
        });
        py.setStderr({
          batched: (s) => io.stderr(s),
        });
        try {
          const out = await py.runPythonAsync(code);
          // Expressions return a value; statements typically return undefined
          if (out !== undefined && out !== null) {
            io.stdout(`${String(out)}\n`);
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          io.stderr(`${msg}\n`);
        }
      },
    };
  }

  dispose(): void {
    this.pyodide = null;
    this.loading = null;
    this.codeopReady = false;
  }
}

function createPythonBackend(
  session: PyodideSession,
  openRepl: () => void,
): ExecutionBackend {
  return {
    id: 'browser-python',
    info: {
      id: 'browser-python',
      label: 'Python (browser / Pyodide)',
      languages: ['python'],
      requiresNetwork: true,
      requiresRemote: false,
    },
    openTerminal: openRepl,
    async startSession() {
      await session.ensure();
    },
    async run(opts) {
      const py = await session.ensure();
      py.setStdout({
        batched: (s) => {
          opts.onStdout?.(s.endsWith('\n') ? s : `${s}\n`);
        },
      });
      py.setStderr({
        batched: (s) => {
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
  throw new Error('zcode-runtime-core not available (globalThis.zcodeRuntime)');
}

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const session = new PyodideSession();

  const openRepl = () => {
    try {
      openPyodideReplTerminal(
        { ensure: async () => session.asReplEngine() },
        'Python (Pyodide)',
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      void vscode.window.showErrorMessage(`Pyodide REPL: ${msg}`);
    }
  };

  const backend = createPythonBackend(session, openRepl);

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
    vscode.commands.registerCommand('zcode.runtime.python.repl', openRepl),
    vscode.window.registerTerminalProfileProvider('zcode.pyodide', {
      provideTerminalProfile: () => {
        const { pty } = createPyodideReplPty({
          ensure: async () => session.asReplEngine(),
        });
        return {
          options: {
            name: 'Python (Pyodide)',
            pty,
            iconPath: new vscode.ThemeIcon('python'),
          },
        };
      },
    }),
    {
      dispose: () => {
        const api = (globalThis as { zcodeRuntime?: ZcodeRuntimeApi }).zcodeRuntime;
        api?.unregister(backend.id);
        session.dispose();
      },
    },
  );
}

export function deactivate(): void {
  /* disposed via subscriptions */
}
