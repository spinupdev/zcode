#!/usr/bin/env node
/**
 * ZCode CLI
 *
 *   zcode web --dir apps/web/dist --port 5000
 *   zcode serve . --port 8080 --password secret
 *   zcode git-proxy [--port]
 */

const HELP = `
ZCode — dual-mode VS Code OSS browser IDE

Usage:
  zcode <command> [options]

Commands:
  web         /ide + /git-proxy + assets; SPA debug UI at / only in DEV
  serve       Login wrapper + same routes + optional REH
  git-proxy   Standalone CORS proxy (usually unnecessary)

  help | version

SPA debug (apps/web at /) is off when NODE_ENV/ZCODE_ENV is production.
  Enable:  NODE_ENV=development | ZCODE_SPA_DEBUG=1 | --spa-debug
  Disable: NODE_ENV=production  | ZCODE_SPA_DEBUG=0 | --no-spa-debug

Examples:
  ./scripts/fetch-vscode-web.sh          # stage VS Code Web (dogfood or owned)
  pnpm --filter @zcode/workbench build
  NODE_ENV=development zcode web --dir apps/web/dist --port 5000
  # open http://127.0.0.1:5000/       → debug SPA (DEV only)
  # open http://127.0.0.1:5000/ide/   → VS Code Web workbench (product)

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
    const spaDebug = hasFlag(args, '--spa-debug')
      ? true
      : hasFlag(args, '--no-spa-debug')
        ? false
        : undefined;
    const srv = await startServer({
      host,
      port,
      password,
      workspace,
      staticDir,
      spaDebug,
      spawnReh: hasFlag(args, '--reh') ? true : hasFlag(args, '--no-reh') ? false : undefined,
      gitProxy: !hasFlag(args, '--no-git-proxy'),
    });
    console.log(`ZCode serve ${srv.url}`);
    console.log(`authority=${srv.authority} reh=${srv.rehMode}`);
    console.log(`git-proxy ${new URL('git-proxy', srv.url).href}`);
    console.log(`ide      ${new URL('ide/', srv.url).href}  (VS Code Web when staged)`);
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
    break;
  }
  case 'web': {
    const { startStaticServer } = await import('./static-server.js');
    const dir = flag(args, '--dir') ?? 'apps/web/dist';
    const port = Number(flag(args, '--port') ?? 5000);
    const host = flag(args, '--host') ?? '127.0.0.1';
    const spaDebug = hasFlag(args, '--spa-debug')
      ? true
      : hasFlag(args, '--no-spa-debug')
        ? false
        : undefined;
    const srv = await startStaticServer({
      host,
      port,
      dir,
      spaDebug,
      gitProxy: !hasFlag(args, '--no-git-proxy'),
      // Leave repoRoot unset so static-server discovers monorepo root from --dir
      // (Playwright and other tools may start the server with a non-repo cwd).
    });
    console.log(`zcode web ${srv.url}`);
    if (srv.spaDebug) console.log(`spa-debug ON  → ${dir}  (DEV dogfood only)`);
    else console.log(`spa-debug OFF → / redirects to /ide/`);
    if (srv.gitProxyUrl) console.log(`git-proxy ${srv.gitProxyUrl}`);
    if (srv.ideUrl) console.log(`ide      ${srv.ideUrl}`);
    else console.log('ide      (missing) run: ./scripts/fetch-vscode-web.sh && pnpm --filter @zcode/workbench build');
    break;
  }
  default:
    console.error(`Unknown command: ${cmd}\n`);
    console.log(HELP);
    process.exit(1);
}
