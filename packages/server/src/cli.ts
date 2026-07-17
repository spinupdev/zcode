#!/usr/bin/env node
/**
 * zcode-server — self-host product wrapper entry (R3 skeleton).
 *
 * Usage:
 *   zcode-server --host 127.0.0.1 --port 8080 --password secret
 */

import { startServer } from './http/start.js';

function usage(): never {
  console.log(`Usage: zcode-server [--host 127.0.0.1] [--port 8080] [--password <pw>] [--workspace <dir>]

Starts the ZCode HTTP wrapper (login + session cookie).
VS Code REH process attach is not yet wired — run scripts/build-server.sh for artifacts.
`);
  process.exit(0);
}

function arg(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(name);
  if (i === -1) return fallback;
  return process.argv[i + 1] ?? fallback;
}

if (process.argv.includes('-h') || process.argv.includes('--help')) {
  usage();
}

const host = arg('--host', '127.0.0.1')!;
const port = Number(arg('--port', '8080'));
const password = arg('--password', process.env.ZCODE_PASSWORD ?? 'zcode')!;
const workspace = arg('--workspace', process.cwd())!;

const srv = await startServer({ host, port, password, workspace });
console.log(`ZCode server listening on ${srv.url}`);
console.log(`authority=${srv.authority} (connection token is server-internal only)`);
console.log('POST /login  GET /healthz  GET /v1/session');
