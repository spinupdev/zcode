import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import {
  createGitProxyHandler,
  DEFAULT_ALLOW_HOSTS,
  DEFAULT_GIT_PROXY_PREFIX,
} from '@zcode/git-proxy';

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

  const vscodeWebDir = opts.vscodeWebDir
    ? path.resolve(opts.vscodeWebDir)
    : findFirst([
        path.join(process.cwd(), 'dist/vscode-web'),
        path.join(spaRoot, '../../dist/vscode-web'),
      ]);
  const workbenchDir = opts.workbenchDir
    ? path.resolve(opts.workbenchDir)
    : findFirst([
        path.join(process.cwd(), 'apps/workbench/dist'),
        path.join(spaRoot, '../workbench/dist'),
      ]);
  const extensionsDir = opts.extensionsDir
    ? path.resolve(opts.extensionsDir)
    : findFirst([
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
        serveIdeProduct(res, url, opts.repoRoot ?? process.cwd());
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
  res.writeHead(200, {
    'content-type': TYPES[ext] ?? 'application/octet-stream',
    'cache-control': ext === '.html' ? 'no-store' : 'public, max-age=120',
    'content-length': data.byteLength,
  });
  res.end(data);
  return true;
}

function serveIdeProduct(res: http.ServerResponse, url: URL, repoRoot: string): void {
  try {
    // Lazy require built shell to avoid hard cycle at compile time of cli
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const productPath = path.join(repoRoot, 'product/product.json');
    const overlay = fs.existsSync(productPath)
      ? JSON.parse(fs.readFileSync(productPath, 'utf8'))
      : {};
    const mode = (url.searchParams.get('mode') as 'browser' | 'remote' | null) ?? 'browser';
    const authority = url.searchParams.get('authority') ?? url.searchParams.get('remoteAuthority') ?? undefined;
    // Dynamic import not available sync — inline dual-mode product
    const body =
      mode === 'remote' && authority
        ? {
            productConfiguration: overlay,
            remoteAuthority: authority,
            folderUri: {
              scheme: 'vscode-remote',
              authority,
              path: url.searchParams.get('path') || '/home/workspace',
            },
            additionalBuiltinExtensions: [
              { scheme: 'http', path: '/extensions/zcode-browser-fs' },
              { scheme: 'http', path: '/extensions/zcode-git' },
              { scheme: 'http', path: '/extensions/zcode-diagnostics' },
            ],
            windowIndicator: {
              label: '$(remote) ZCode remote',
              tooltip: `Remote ${authority}`,
            },
          }
        : {
            productConfiguration: overlay,
            folderUri: {
              scheme: 'zcode-opfs',
              path: `/workspace/${url.searchParams.get('workspace') || 'default'}`,
            },
            additionalBuiltinExtensions: [
              { scheme: 'http', path: '/extensions/zcode-browser-fs' },
              { scheme: 'http', path: '/extensions/zcode-git' },
              { scheme: 'http', path: '/extensions/zcode-diagnostics' },
            ],
            windowIndicator: {
              label: '$(remote) ZCode browser',
              tooltip: 'Browser mode',
            },
          };
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
