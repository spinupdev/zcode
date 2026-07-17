#!/usr/bin/env node
import { DEFAULT_ALLOW_HOSTS, startGitProxy } from './index.js';

function arg(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(name);
  if (i === -1) return fallback;
  return process.argv[i + 1] ?? fallback;
}

if (process.argv.includes('-h') || process.argv.includes('--help')) {
  console.log(`Usage: zcode-git-proxy [--host 127.0.0.1] [--port 8787] [--allow-hosts a,b,c]`);
  process.exit(0);
}

const host = arg('--host', '127.0.0.1')!;
const port = Number(arg('--port', '8787'));
const allow = (arg('--allow-hosts') ?? DEFAULT_ALLOW_HOSTS.join(',')).split(',').map((s) => s.trim()).filter(Boolean);

const proxy = await startGitProxy({ host, port, allowHosts: allow });
console.log(`zcode git-proxy listening on ${proxy.url}`);
console.log(`allow-hosts: ${allow.join(', ')}`);
console.log(`isomorphic-git corsProxy: ${proxy.url}`);
