import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { serverArtifactDir, vscodeVendorDir } from '../paths.js';

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
  const root = opts.root ?? process.cwd();
  const artifact = serverArtifactDir(root);
  const host = opts.rehHost ?? '127.0.0.1';

  const artifactServer = findArtifactBinary(artifact);
  if (artifactServer) {
    const child = spawn(
      artifactServer,
      [
        '--without-connection-token', // we inject via wrapper later; use token flag when binary supports it
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
          VSCODE_CONNECTION_TOKEN: opts.connectionToken,
          CONNECTION_TOKEN: opts.connectionToken,
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
        '--connection-token',
        opts.connectionToken,
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

function findArtifactBinary(dir: string): string | null {
  if (!fs.existsSync(dir)) return null;
  const candidates = [
    'bin/code-server-oss',
    'bin/code-server',
    'server.sh',
    'bin/remote-cli/code',
  ];
  for (const c of candidates) {
    const p = path.join(dir, c);
    if (fs.existsSync(p)) return p;
  }
  // recursive shallow search for code-server-oss
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const e of entries) {
      if (e.isDirectory() && (e.name.startsWith('bin') || e.name.includes('server'))) {
        const hit = findArtifactBinary(path.join(dir, e.name));
        if (hit) return hit;
      }
      if (e.isFile() && /code-server/.test(e.name)) {
        return path.join(dir, e.name);
      }
    }
  } catch {
    /* ignore */
  }
  return null;
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
