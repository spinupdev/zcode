import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import {
  createGitProxyHandler,
  DEFAULT_ALLOW_HOSTS,
  DEFAULT_GIT_PROXY_PREFIX,
} from '@zcode/git-proxy';
import {
  applySecurityHeaders,
  buildWorkbenchCreateOptions,
} from '@zcode/server';

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.ttf': 'font/ttf',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.wasm': 'application/wasm',
};

export interface StaticServerOptions {
  host: string;
  port: number;
  /** Browser SPA (apps/web/dist) */
  dir: string;
  /** VS Code Web static tree (dist/vscode-web) */
  vscodeWebDir?: string;
  /** Workbench host page (apps/workbench/dist) */
  workbenchDir?: string;
  /** Built-in extensions root */
  extensionsDir?: string;
  gitProxy?: boolean;
  gitProxyPrefix?: string;
  allowHosts?: string[];
  /** monorepo root for resolving product.json */
  repoRoot?: string;
}

export async function startStaticServer(opts: StaticServerOptions): Promise<{
  url: string;
  gitProxyUrl: string | null;
  ideUrl: string | null;
  close(): Promise<void>;
}> {
  const spaRoot = path.resolve(opts.dir);
  if (!fs.existsSync(spaRoot)) {
    throw new Error(`static dir not found: ${spaRoot} (run pnpm --filter @zcode/web build)`);
  }

  // Discover monorepo root so `zcode web` works when cwd is not the repo
  // (e.g. Playwright webServer with cwd=e2e/, or --dir with absolute paths).
  const repoRoot =
    (opts.repoRoot ? path.resolve(opts.repoRoot) : undefined) ??
    findMonorepoRoot(spaRoot) ??
    findMonorepoRoot(process.cwd()) ??
    process.cwd();

  const vscodeWebDir = opts.vscodeWebDir
    ? path.resolve(opts.vscodeWebDir)
    : findFirst([
        path.join(repoRoot, 'dist/vscode-web'),
        path.join(process.cwd(), 'dist/vscode-web'),
        path.join(spaRoot, '../../../dist/vscode-web'),
      ]);
  const workbenchDir = opts.workbenchDir
    ? path.resolve(opts.workbenchDir)
    : findFirst([
        path.join(repoRoot, 'apps/workbench/dist'),
        path.join(process.cwd(), 'apps/workbench/dist'),
        path.join(spaRoot, '../../workbench/dist'),
      ]);
  const extensionsDir = opts.extensionsDir
    ? path.resolve(opts.extensionsDir)
    : findFirst([
        path.join(repoRoot, 'extensions'),
        path.join(process.cwd(), 'extensions'),
        workbenchDir ? path.join(workbenchDir, 'extensions') : '',
      ].filter(Boolean));

  const gitProxyEnabled = opts.gitProxy !== false;
  const prefix = opts.gitProxyPrefix ?? DEFAULT_GIT_PROXY_PREFIX;
  const gitProxyHandler = gitProxyEnabled
    ? createGitProxyHandler({
        prefix,
        allowHosts: opts.allowHosts ?? DEFAULT_ALLOW_HOSTS,
      })
    : null;

  const server = http.createServer((req, res) => {
    void (async () => {
      if (gitProxyHandler && (await gitProxyHandler(req, res))) {
        return;
      }

      const host = req.headers.host ?? 'localhost';
      const url = new URL(req.url ?? '/', `http://${host}`);
      const pathname = decodeURIComponent(url.pathname);

      // Dynamic product for dual-mode IDE
      if (pathname === '/ide/product.json' || pathname === '/product.json') {
        serveIdeProduct(res, url, repoRoot);
        return;
      }

      if (pathname === '/ide' || pathname === '/ide/') {
        if (workbenchDir && serveFile(res, path.join(workbenchDir, 'index.html'))) return;
        res.writeHead(503, { 'content-type': 'text/plain' }).end(
          'Workbench not built. Run: pnpm --filter @zcode/workbench build && ./scripts/fetch-vscode-web.sh\n',
        );
        return;
      }

      if (pathname.startsWith('/ide/')) {
        const rel = pathname.slice('/ide/'.length);
        if (workbenchDir && tryStatic(res, workbenchDir, rel)) return;
      }

      if (pathname.startsWith('/vscode/')) {
        const rel = pathname.slice('/vscode/'.length);
        if (vscodeWebDir && tryStatic(res, vscodeWebDir, rel)) return;
        res.writeHead(404).end('vscode-web not staged — run ./scripts/fetch-vscode-web.sh');
        return;
      }

      if (pathname.startsWith('/extensions/')) {
        const rel = pathname.slice('/extensions/'.length);
        if (extensionsDir && tryStatic(res, extensionsDir, rel)) return;
      }

      // SPA root
      let rel = pathname === '/' ? '/index.html' : pathname;
      if (rel.includes('..')) {
        res.writeHead(400).end('bad path');
        return;
      }
      if (tryStatic(res, spaRoot, rel.replace(/^\//, ''))) return;
      // SPA fallback
      if (serveFile(res, path.join(spaRoot, 'index.html'))) return;
      res.writeHead(404).end('not found');
    })();
  });

  await new Promise<void>((resolve, reject) => {
    server.listen(opts.port, opts.host, () => resolve());
    server.on('error', reject);
  });

  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : opts.port;
  const host = opts.host === '0.0.0.0' ? '127.0.0.1' : opts.host;
  const url = `http://${host}:${port}/`;

  return {
    url,
    gitProxyUrl: gitProxyEnabled ? `http://${host}:${port}${prefix}` : null,
    ideUrl: workbenchDir ? `http://${host}:${port}/ide/` : null,
    close: () =>
      new Promise((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}

function findFirst(paths: string[]): string | undefined {
  for (const p of paths) {
    if (p && fs.existsSync(p)) return p;
  }
  return undefined;
}

/** Walk up from `from` until pnpm-workspace.yaml or product/ is found. */
function findMonorepoRoot(from: string): string | undefined {
  let dir = path.resolve(from);
  for (let i = 0; i < 10; i++) {
    if (
      fs.existsSync(path.join(dir, 'pnpm-workspace.yaml')) ||
      fs.existsSync(path.join(dir, 'product', 'product.json'))
    ) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return undefined;
}

function tryStatic(res: http.ServerResponse, root: string, rel: string): boolean {
  const file = path.join(root, rel);
  if (!file.startsWith(path.resolve(root))) return false;
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    // directory index
    const index = path.join(file, 'index.html');
    if (fs.existsSync(index)) return serveFile(res, index);
    return false;
  }
  return serveFile(res, file);
}

function serveFile(res: http.ServerResponse, file: string): boolean {
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) return false;
  const data = fs.readFileSync(file);
  const ext = path.extname(file);
  const headers: Record<string, string | number | string[]> = {
    'content-type': TYPES[ext] ?? 'application/octet-stream',
    'cache-control': ext === '.html' ? 'no-store' : 'public, max-age=120',
    'content-length': data.byteLength,
  };
  if (ext === '.html') applySecurityHeaders(headers);
  res.writeHead(200, headers);
  res.end(data);
  return true;
}

function serveIdeProduct(res: http.ServerResponse, url: URL, repoRoot: string): void {
  try {
    const productPath = path.join(repoRoot, 'product/product.json');
    const overlay = fs.existsSync(productPath)
      ? (JSON.parse(fs.readFileSync(productPath, 'utf8')) as Record<string, unknown>)
      : { nameShort: 'ZCode', nameLong: 'ZCode', applicationName: 'zcode' };
    const modeParam = url.searchParams.get('mode');
    const remoteAuth =
      url.searchParams.get('authority') ?? url.searchParams.get('remoteAuthority') ?? undefined;
    const mode =
      modeParam === 'remote' || (modeParam !== 'browser' && remoteAuth) ? 'remote' : 'browser';
    const body = buildWorkbenchCreateOptions({
      mode,
      remoteAuthority: mode === 'remote' ? remoteAuth ?? url.host : undefined,
      workspaceId: url.searchParams.get('workspace') || 'default',
      remoteWorkspacePath: url.searchParams.get('path') || '/home/workspace',
      productOverlay: overlay,
      origin: `${url.protocol}//${url.host}`,
      connectionReady: mode === 'remote' ? true : undefined,
    });
    const data = JSON.stringify(body);
    res.writeHead(200, {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    });
    res.end(data);
  } catch (err) {
    res.writeHead(500, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: String(err) }));
  }
}
