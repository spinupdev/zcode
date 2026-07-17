#!/usr/bin/env node
import { startServer } from './http/start.js';

function usage(): never {
  console.log(`Usage: zcode-server [options]

  --host <addr>         default 127.0.0.1
  --port <n>            default 8080
  --password <pw>       default env ZCODE_PASSWORD or "zcode"
  --workspace <dir>     default cwd
  --static-dir <dir>    co-serve debug SPA at /debug/ (default: apps/web/dist if present; DEV only)
  --spa-debug           force enable SPA debug UI at /debug/
  --no-spa-debug        force disable SPA (production default when NODE_ENV=production)
  --no-reh              do not attempt REH spawn
`);
  process.exit(0);
}

function arg(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(name);
  if (i === -1) return fallback;
  return process.argv[i + 1] ?? fallback;
}

if (process.argv.includes('-h') || process.argv.includes('--help')) usage();

const host = arg('--host', '127.0.0.1')!;
const port = Number(arg('--port', '8080'));
const password = arg('--password', process.env.ZCODE_PASSWORD ?? 'zcode')!;
const workspace = arg('--workspace', process.cwd())!;
const staticDir = arg('--static-dir');
const spawnReh = !process.argv.includes('--no-reh');
const spaDebug = process.argv.includes('--spa-debug')
  ? true
  : process.argv.includes('--no-spa-debug')
    ? false
    : undefined;

const srv = await startServer({
  host,
  port,
  password,
  workspace,
  staticDir,
  spaDebug,
  spawnReh,
});
console.log(`ZCode server ${srv.url}`);
console.log(`authority=${srv.authority} reh=${srv.rehMode}`);
console.log('POST /login  GET /healthz  SPA debug only when not production');
