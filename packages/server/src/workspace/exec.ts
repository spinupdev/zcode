/**
 * RA3 — execution-only remote: run code on the server workspace without full REH attach.
 * Cookie-auth only; fixed runners (no free-form shell).
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';

export type ExecLanguage = 'javascript' | 'typescript' | 'python' | 'python3' | 'shell';

export interface ExecRequest {
  language: string;
  /** Inline source (preferred for browser OPFS files) */
  code?: string;
  /** Relative path under workspace (mutually exclusive with writing temp from code) */
  relativePath?: string;
  /** Optional argv after script path */
  args?: string[];
  timeoutMs?: number;
}

export interface ExecResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  timedOut?: boolean;
  runner: string[];
}

export class ExecError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
    this.name = 'ExecError';
  }
}

const MAX_CODE_BYTES = 2 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_TIMEOUT_MS = 120_000;
const MAX_OUTPUT_BYTES = 2 * 1024 * 1024;

function resolveRunner(language: string): { cmd: string; argsPrefix: string[]; ext: string } {
  const lang = language.toLowerCase();
  switch (lang) {
    case 'javascript':
    case 'javascriptreact':
    case 'js':
      return { cmd: 'node', argsPrefix: [], ext: '.js' };
    case 'typescript':
    case 'typescriptreact':
    case 'ts':
      // Best-effort: node --experimental-strip-types when available; else node as .mjs stripped client-side
      return { cmd: 'node', argsPrefix: ['--experimental-strip-types'], ext: '.ts' };
    case 'python':
    case 'python3':
      return { cmd: process.platform === 'win32' ? 'python' : 'python3', argsPrefix: [], ext: '.py' };
    default:
      throw new ExecError(`unsupported language: ${language}`);
  }
}

function safeRel(rel: string): string {
  const n = rel.replace(/\\/g, '/').replace(/^\/+/, '');
  if (!n || n.includes('..') || path.isAbsolute(n)) {
    throw new ExecError(`invalid relativePath: ${rel}`);
  }
  return n;
}

/**
 * Run code or workspace-relative file under workspaceRoot.
 */
export async function runExec(workspaceRoot: string, req: ExecRequest): Promise<ExecResult> {
  const root = path.resolve(workspaceRoot);
  if (!fs.existsSync(root)) {
    throw new ExecError('workspace unavailable', 503);
  }

  const timeoutMs = Math.min(
    Math.max(req.timeoutMs ?? DEFAULT_TIMEOUT_MS, 1000),
    MAX_TIMEOUT_MS,
  );
  const { cmd, argsPrefix, ext } = resolveRunner(req.language);

  let scriptPath: string;
  let cleanup: string | null = null;

  if (req.relativePath) {
    const rel = safeRel(req.relativePath);
    scriptPath = path.resolve(root, rel);
    if (!scriptPath.startsWith(root + path.sep) && scriptPath !== root) {
      throw new ExecError('path escapes workspace');
    }
    if (!fs.existsSync(scriptPath)) {
      throw new ExecError(`file not found: ${rel}`, 404);
    }
  } else if (typeof req.code === 'string') {
    const buf = Buffer.from(req.code, 'utf8');
    if (buf.byteLength > MAX_CODE_BYTES) {
      throw new ExecError('code too large', 413);
    }
    const tmpDir = path.join(os.tmpdir(), 'zcode-exec');
    fs.mkdirSync(tmpDir, { recursive: true });
    cleanup = path.join(tmpDir, `${randomBytes(8).toString('hex')}${ext}`);
    fs.writeFileSync(cleanup, buf);
    scriptPath = cleanup;
  } else {
    throw new ExecError('code or relativePath required');
  }

  const extraArgs = Array.isArray(req.args)
    ? req.args.filter((a) => typeof a === 'string' && a.length < 1024).slice(0, 32)
    : [];
  const argv = [...argsPrefix, scriptPath, ...extraArgs];

  try {
    return await spawnCapture(cmd, argv, {
      cwd: root,
      timeoutMs,
    });
  } finally {
    if (cleanup) {
      try {
        fs.unlinkSync(cleanup);
      } catch {
        /* ignore */
      }
    }
  }
}

function spawnCapture(
  cmd: string,
  args: string[],
  opts: { cwd: string; timeoutMs: number },
): Promise<ExecResult> {
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let settled = false;

    const child = spawn(cmd, args, {
      cwd: opts.cwd,
      env: {
        ...process.env,
        // Avoid inheriting huge env; keep PATH for finding node/python
        PATH: process.env.PATH,
        HOME: process.env.HOME,
        LANG: process.env.LANG ?? 'C.UTF-8',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, opts.timeoutMs);

    const onChunk = (which: 'out' | 'err') => (chunk: Buffer) => {
      const s = chunk.toString('utf8');
      if (which === 'out') {
        stdout += s;
        if (stdout.length > MAX_OUTPUT_BYTES) stdout = stdout.slice(0, MAX_OUTPUT_BYTES) + '\n…[truncated]';
      } else {
        stderr += s;
        if (stderr.length > MAX_OUTPUT_BYTES) stderr = stderr.slice(0, MAX_OUTPUT_BYTES) + '\n…[truncated]';
      }
    };

    child.stdout?.on('data', onChunk('out'));
    child.stderr?.on('data', onChunk('err'));

    child.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({
        exitCode: 127,
        stdout,
        stderr: stderr + (stderr ? '\n' : '') + String(err.message),
        runner: [cmd, ...args],
      });
    });

    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({
        exitCode: timedOut ? 124 : (code ?? 1),
        stdout,
        stderr,
        timedOut,
        runner: [cmd, ...args],
      });
    });
  });
}
