import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};

export async function startStaticServer(opts: {
  host: string;
  port: number;
  dir: string;
}): Promise<{ url: string; close(): Promise<void> }> {
  const root = path.resolve(opts.dir);
  if (!fs.existsSync(root)) {
    throw new Error(`static dir not found: ${root} (run pnpm --filter @zcode/web build)`);
  }

  const server = http.createServer((req, res) => {
    let rel = decodeURIComponent((req.url ?? '/').split('?')[0] ?? '/');
    if (rel === '/') rel = '/index.html';
    if (rel.includes('..')) {
      res.writeHead(400).end('bad path');
      return;
    }
    const file = path.join(root, rel);
    if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404).end('not found');
      return;
    }
    const data = fs.readFileSync(file);
    res.writeHead(200, {
      'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream',
      'cache-control': 'no-store',
    });
    res.end(data);
  });

  await new Promise<void>((resolve, reject) => {
    server.listen(opts.port, opts.host, () => resolve());
    server.on('error', reject);
  });

  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : opts.port;
  const host = opts.host === '0.0.0.0' ? '127.0.0.1' : opts.host;
  return {
    url: `http://${host}:${port}/`,
    close: () =>
      new Promise((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}
