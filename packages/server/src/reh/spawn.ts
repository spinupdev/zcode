import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { monorepoRoot, vscodeVendorDir } from '../paths.js';
import { findRehBinary } from './artifact.js';

export interface RehSpawnOptions {
  connectionToken: string;
  /** Host port the product wrapper listens on — REH binds to an internal port */
  rehHost?: string;
  rehPort: number;
  workspace: string;
  root?: string;
}

export interface RehHandle {
  process: ChildProcess;
  endpoint: string;
  mode: 'artifact' | 'dev-script' | 'none';
  stop(): Promise<void>;
}

/**
 * Prefer packaged REH under dist/server; fall back to vendor/vscode scripts/code-server.sh
 * when compiled in-tree. Returns mode none if neither is available.
 */
export function spawnReh(opts: RehSpawnOptions): RehHandle {
  const root = opts.root ?? monorepoRoot();
  const host = opts.rehHost ?? '127.0.0.1';

  // Security model (R3b / KD12):
  // - REH listens on loopback only; the shell cookie proxy is the sole client path.
  // - VS Code WS handshake requires the *browser* to know connectionToken for msg1.auth.
  // - Putting that token in the workbench would put it in JS memory / risk URL leaks.
  // - Therefore default REH with --without-connection-token when secured by our proxy.
  // - Set ZCODE_REH_REQUIRE_TOKEN=1 to force --connection-token (then expose token via
  //   authenticated session API — not the default).
  const requireToken = process.env.ZCODE_REH_REQUIRE_TOKEN === '1';
  const tokenArgs = requireToken
    ? (['--connection-token', opts.connectionToken] as string[])
    : (['--without-connection-token'] as string[]);

  const artifactServer = findRehBinary(path.join(root, 'dist', 'server'));
  if (artifactServer) {
    const child = spawn(
      artifactServer,
      [
        ...tokenArgs,
        '--accept-server-license-terms',
        '--host',
        host,
        '--port',
        String(opts.rehPort),
        opts.workspace,
      ],
      {
        env: {
          ...process.env,
          ...(requireToken
            ? {
                VSCODE_CONNECTION_TOKEN: opts.connectionToken,
                CONNECTION_TOKEN: opts.connectionToken,
              }
            : {}),
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    pipeLogs(child, 'reh');
    return wrap(child, `http://${host}:${opts.rehPort}`, 'artifact');
  }

  const vscode = vscodeVendorDir(root);
  const devScript = path.join(vscode, 'scripts', 'code-server.sh');
  if (fs.existsSync(devScript)) {
    const child = spawn(
      devScript,
      [
        '--host',
        host,
        '--port',
        String(opts.rehPort),
        ...tokenArgs,
        opts.workspace,
      ],
      {
        cwd: vscode,
        env: { ...process.env, VSCODE_SKIP_PRELAUNCH: process.env.VSCODE_SKIP_PRELAUNCH },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    pipeLogs(child, 'reh-dev');
    return wrap(child, `http://${host}:${opts.rehPort}`, 'dev-script');
  }

  return {
    process: null as unknown as ChildProcess,
    endpoint: '',
    mode: 'none',
    async stop() {
      /* no-op */
    },
  };
}

function pipeLogs(child: ChildProcess, tag: string): void {
  child.stdout?.on('data', (d) => process.stdout.write(`[${tag}] ${d}`));
  child.stderr?.on('data', (d) => process.stderr.write(`[${tag}] ${d}`));
}

function wrap(child: ChildProcess, endpoint: string, mode: RehHandle['mode']): RehHandle {
  return {
    process: child,
    endpoint,
    mode,
    stop: () =>
      new Promise((resolve) => {
        if (!child.pid) {
          resolve();
          return;
        }
        child.once('exit', () => resolve());
        child.kill('SIGTERM');
        setTimeout(() => {
          try {
            child.kill('SIGKILL');
          } catch {
            /* ignore */
          }
          resolve();
        }, 3000).unref?.();
      }),
  };
}
