/**
 * RA3 — execution-only remote backend.
 * Workspace stays zcode-opfs; Run File posts to same-origin POST /v1/exec (cookie auth).
 * No remoteAuthority reload.
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
  setActive(id: string | 'auto'): void;
}

interface SessionJson {
  authenticated?: boolean;
  executionOnly?: boolean;
  workspacePath?: string | null;
}

function createRemoteBackend(): ExecutionBackend {
  return {
    id: 'remote-reh',
    info: {
      id: 'remote-reh',
      label: 'Remote (server exec, no reload)',
      languages: ['javascript', 'typescript', 'python', 'javascriptreact', 'typescriptreact'],
      requiresNetwork: true,
      requiresRemote: true,
    },
    async startSession() {
      const sess = await fetchSession();
      if (!sess?.authenticated || !sess.executionOnly) {
        throw new Error('Not signed in or server execution unavailable. Open /login on zcode serve.');
      }
    },
    async run(opts) {
      const controller = new AbortController();
      const onAbort = () => controller.abort();
      opts.signal?.addEventListener('abort', onAbort, { once: true });
      try {
        const res = await fetch('/v1/exec', {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'content-type': 'application/json' },
          signal: controller.signal,
          body: JSON.stringify({
            language: opts.languageId,
            code: opts.code,
            timeoutMs: 60_000,
          }),
        });
        if (res.status === 401) {
          opts.onStderr?.('Unauthorized — sign in at /login\n');
          return { exitCode: 1, streamed: true };
        }
        if (!res.ok) {
          const err = (await res.json().catch(() => ({}))) as { error?: string };
          opts.onStderr?.(`${err.error ?? `HTTP ${res.status}`}\n`);
          return { exitCode: 1, streamed: true };
        }
        const body = (await res.json()) as {
          exitCode: number;
          stdout?: string;
          stderr?: string;
          timedOut?: boolean;
          runner?: string[];
        };
        if (body.runner?.length) {
          opts.onStdout?.(`$ ${body.runner.join(' ')}\n`);
        }
        if (body.stdout) opts.onStdout?.(body.stdout.endsWith('\n') ? body.stdout : `${body.stdout}\n`);
        if (body.stderr) opts.onStderr?.(body.stderr.endsWith('\n') ? body.stderr : `${body.stderr}\n`);
        if (body.timedOut) opts.onStderr?.('(timed out)\n');
        return { exitCode: body.exitCode ?? 1, streamed: true };
      } catch (err) {
        if ((err as Error).name === 'AbortError') {
          return { exitCode: 130, streamed: true };
        }
        const msg = err instanceof Error ? err.message : String(err);
        opts.onStderr?.(`${msg}\n`);
        return { exitCode: 1, streamed: true };
      } finally {
        opts.signal?.removeEventListener('abort', onAbort);
      }
    },
    dispose() {
      /* no-op */
    },
  };
}

async function fetchSession(): Promise<SessionJson | null> {
  try {
    const res = await fetch('/v1/session', { credentials: 'same-origin', cache: 'no-store' });
    if (!res.ok) return null;
    return (await res.json()) as SessionJson;
  } catch {
    return null;
  }
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
  const backend = createRemoteBackend();
  let registered = false;
  let api: ZcodeRuntimeApi | undefined;

  try {
    api = await waitForRuntime();
  } catch (err) {
    console.warn('[zcode-runtime-remote]', err);
    return;
  }

  const sync = async () => {
    const sess = await fetchSession();
    const available = Boolean(sess?.authenticated && sess.executionOnly);
    if (available && !registered) {
      api!.register(backend);
      registered = true;
      if (vscode.workspace.getConfiguration('zcode.execution').get<boolean>('preferRemote')) {
        api!.setActive('remote-reh');
      }
    } else if (!available && registered) {
      api!.unregister(backend.id);
      registered = false;
    }
  };

  await sync();
  const timer = setInterval(() => void sync(), 15_000);

  context.subscriptions.push(
    {
      dispose: () => {
        clearInterval(timer);
        if (registered) api?.unregister(backend.id);
        backend.dispose();
      },
    },
    vscode.commands.registerCommand('zcode.runtime.remote.refresh', async () => {
      await sync();
      void vscode.window.showInformationMessage(
        registered
          ? 'Remote execution backend is available (Run File → Remote).'
          : 'Remote execution unavailable — use zcode serve and sign in.',
      );
    }),
    vscode.commands.registerCommand('zcode.runtime.remote.use', async () => {
      await sync();
      if (!registered) {
        void vscode.window.showErrorMessage(
          'Remote execution not available. Sign in on zcode serve (cookie session).',
        );
        return;
      }
      api!.setActive('remote-reh');
      await vscode.workspace
        .getConfiguration('zcode.execution')
        .update('backend', 'remote-reh', vscode.ConfigurationTarget.Global);
      void vscode.window.showInformationMessage(
        'Using remote server execution (no workbench reload). Workspace stays in the browser.',
      );
    }),
  );
}

export function deactivate(): void {
  /* via subscriptions */
}
