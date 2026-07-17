#!/usr/bin/env node
/**
 * ZCode CLI
 *
 *   zcode serve [dir] [--port] [--password] [--host] [--static-dir] [--no-reh]
 *   zcode git-proxy [--port] [--host] [--allow-hosts]
 *   zcode web --dir dist [--port] [--host]
 */

const HELP = `
ZCode — dual-mode VS Code OSS browser IDE

Usage:
  zcode <command> [options]

Commands:
  serve       Self-hosted server (login + static workspace + optional REH)
  git-proxy   HTTP CORS proxy for browser isomorphic-git
  web         Serve a static directory (dev)

  help        Show this help
  version     Print version

Examples:
  zcode git-proxy --port 8787
  zcode serve . --port 8080 --password secret
  zcode web --dir apps/web/dist --port 3000

Not affiliated with coder/code-server.
`.trim();

const args = process.argv.slice(2);
const cmd = args[0];

function flag(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(name);
  if (i === -1) return undefined;
  return argv[i + 1];
}

function hasFlag(argv: string[], name: string): boolean {
  return argv.includes(name);
}

switch (cmd) {
  case undefined:
  case 'help':
  case '--help':
  case '-h':
    console.log(HELP);
    process.exit(0);
    break;
  case 'version':
  case '--version':
  case '-v':
    console.log('0.0.0-dev');
    process.exit(0);
    break;
  case 'serve': {
    const { startServer } = await import('@zcode/server');
    const port = Number(flag(args, '--port') ?? 8080);
    const host = flag(args, '--host') ?? '127.0.0.1';
    const password = flag(args, '--password') ?? process.env.ZCODE_PASSWORD ?? 'zcode';
    const workspace = args[1] && !args[1].startsWith('-') ? args[1] : process.cwd();
    const staticDir = flag(args, '--static-dir');
    const srv = await startServer({
      host,
      port,
      password,
      workspace,
      staticDir,
      spawnReh: !hasFlag(args, '--no-reh'),
    });
    console.log(`ZCode serve ${srv.url}`);
    console.log(`authority=${srv.authority} reh=${srv.rehMode}`);
    console.log('Login at /login — then open /index.html for browser workspace (if built).');
    break;
  }
  case 'git-proxy': {
    const { startGitProxy, DEFAULT_ALLOW_HOSTS } = await import('@zcode/git-proxy');
    const port = Number(flag(args, '--port') ?? 8787);
    const host = flag(args, '--host') ?? '127.0.0.1';
    const allow = (flag(args, '--allow-hosts') ?? DEFAULT_ALLOW_HOSTS.join(','))
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const proxy = await startGitProxy({ host, port, allowHosts: allow });
    console.log(`zcode git-proxy ${proxy.url}`);
    console.log(`allow-hosts: ${allow.join(', ')}`);
    console.log(`Use as isomorphic-git corsProxy: ${proxy.url}`);
    break;
  }
  case 'web': {
    const { startStaticServer } = await import('./static-server.js');
    const dir = flag(args, '--dir') ?? 'apps/web/dist';
    const port = Number(flag(args, '--port') ?? 3000);
    const host = flag(args, '--host') ?? '127.0.0.1';
    const srv = await startStaticServer({ host, port, dir });
    console.log(`zcode web ${srv.url} → ${dir}`);
    break;
  }
  default:
    console.error(`Unknown command: ${cmd}\n`);
    console.log(HELP);
    process.exit(1);
}
