#!/usr/bin/env node
/**
 * ZCode CLI entrypoint.
 *
 * Planned commands:
 *   zcode serve <dir> [--port] [--auth password]
 *   zcode git-proxy [--port] [--allow-hosts]
 *   zcode web --dir dist/web [--port]
 */

const HELP = `
ZCode — dual-mode VS Code OSS browser IDE

Usage:
  zcode <command> [options]

Commands (scaffolded; implementations land in Track R/B):
  serve       Start self-hosted remote IDE (PR R5)
  git-proxy   HTTP CORS proxy for browser git (Track B4)
  web         Serve static workbench assets (dev)

  help        Show this help
  version     Print version

This project is not affiliated with coder/code-server.
Docs: docs/design-dual-mode-vscode-ide.md
`.trim();

const args = process.argv.slice(2);
const cmd = args[0];

function flag(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(name);
  if (i === -1) return undefined;
  return argv[i + 1];
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
    // Delegate to @zcode/server when built (R3 skeleton HTTP wrapper).
    const { startServer } = await import('@zcode/server');
    const port = Number(flag(args, '--port') ?? 8080);
    const host = flag(args, '--host') ?? '127.0.0.1';
    const password = flag(args, '--password') ?? process.env.ZCODE_PASSWORD ?? 'zcode';
    const workspace = args[1] && !args[1].startsWith('-') ? args[1] : process.cwd();
    const srv = await startServer({ host, port, password, workspace });
    console.log(`ZCode serve ${srv.url}`);
    console.log(`authority=${srv.authority}`);
    console.log('Password login at /login — session cookie is HttpOnly (no token in URL).');
    break;
  }
  case 'git-proxy':
  case 'web':
    console.error(
      `zcode ${cmd}: not implemented yet. See docs/design-dual-mode-vscode-ide.md`,
    );
    process.exit(1);
    break;
  default:
    console.error(`Unknown command: ${cmd}\n`);
    console.log(HELP);
    process.exit(1);
}
