#!/usr/bin/env node
/**
 * ZCode CLI
 *
 *   zcode serve [dir] [--port] [--password] [--host] [--static-dir] [--no-reh] [--no-git-proxy]
 *   zcode git-proxy [--port] [--host] [--allow-hosts]
 *   zcode web --dir dist [--port] [--host] [--no-git-proxy]
 */

const HELP = `
ZCode — dual-mode VS Code OSS browser IDE

Usage:
  zcode <command> [options]

Commands:
  serve       Login + static workspace + same-origin /git-proxy + optional REH
  git-proxy   Standalone CORS proxy (usually unnecessary if you use serve/web)
  web         Static SPA + same-origin /git-proxy (dev / simple host)

  help        Show this help
  version     Print version

Examples:
  # One process: SPA + /git-proxy on :5000
  zcode web --dir apps/web/dist --port 5000

  # Self-host with password
  zcode serve . --port 8080 --password secret --no-reh

  # Standalone proxy only (optional)
  zcode git-proxy --port 8787

Browser config default: {origin}/git-proxy
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
      // REH only when --reh or packaged dist/server exists (see startServer)
      spawnReh: hasFlag(args, '--reh') ? true : hasFlag(args, '--no-reh') ? false : undefined,
      gitProxy: !hasFlag(args, '--no-git-proxy'),
    });
    console.log(`ZCode serve ${srv.url}`);
    console.log(`authority=${srv.authority} reh=${srv.rehMode}`);
    console.log(`git-proxy ${new URL('git-proxy', srv.url).href} (same-origin, stateless)`);
    console.log('Login at /login — workspace at /index.html when apps/web/dist is present.');
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
    console.log(`zcode git-proxy ${proxy.url} (standalone root mount)`);
    console.log(`allow-hosts: ${allow.join(', ')}`);
    console.log(`Prefer same-origin: zcode web … → {origin}/git-proxy`);
    break;
  }
  case 'web': {
    const { startStaticServer } = await import('./static-server.js');
    const dir = flag(args, '--dir') ?? 'apps/web/dist';
    const port = Number(flag(args, '--port') ?? 5000);
    const host = flag(args, '--host') ?? '127.0.0.1';
    const srv = await startStaticServer({
      host,
      port,
      dir,
      gitProxy: !hasFlag(args, '--no-git-proxy'),
    });
    console.log(`zcode web ${srv.url} → ${dir}`);
    if (srv.gitProxyUrl) {
      console.log(`git-proxy ${srv.gitProxyUrl} (same-origin, stateless)`);
    }
    break;
  }
  default:
    console.error(`Unknown command: ${cmd}\n`);
    console.log(HELP);
    process.exit(1);
}
