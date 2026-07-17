#!/usr/bin/env node
import { startServer } from './http/start.js';

function usage(): never {
  console.log(`Usage: zcode-server [options]

  --host <addr>         default 127.0.0.1
  --port <n>            default 8080
  --password <pw>       default env ZCODE_PASSWORD or "zcode"
  --workspace <dir>     default cwd
  --static-dir <dir>    co-serve browser app (default: apps/web/dist if present)
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

const srv = await startServer({
  host,
  port,
  password,
  workspace,
  staticDir,
  spawnReh,
});
console.log(`ZCode server ${srv.url}`);
console.log(`authority=${srv.authority} reh=${srv.rehMode}`);
console.log('POST /login  GET /healthz  static apps/web/dist when built');
