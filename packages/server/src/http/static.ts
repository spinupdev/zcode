import fs from 'node:fs';
import path from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { applySecurityHeaders } from './csp.js';

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.map': 'application/json',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.ico': 'image/x-icon',
  '.wasm': 'application/wasm',
  '.txt': 'text/plain; charset=utf-8',
};

export function tryServeStatic(
  req: IncomingMessage,
  res: ServerResponse,
  staticDir: string,
  urlPath: string,
): boolean {
  if (req.method !== 'GET' && req.method !== 'HEAD') return false;

  let rel = decodeURIComponent(urlPath.split('?')[0] ?? '/');
  if (rel === '/') rel = '/index.html';
  if (rel.includes('..')) {
    res.writeHead(400).end('bad path');
    return true;
  }

  const filePath = path.join(staticDir, rel);
  if (!filePath.startsWith(path.resolve(staticDir))) {
    res.writeHead(403).end('forbidden');
    return true;
  }
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    return false;
  }

  const ext = path.extname(filePath);
  const type = TYPES[ext] ?? 'application/octet-stream';
  const data = fs.readFileSync(filePath);
  const headers: Record<string, string | number | string[]> = {
    'content-type': type,
    'content-length': data.byteLength,
    'cache-control': ext === '.html' ? 'no-store' : 'public, max-age=60',
  };
  // HTML + workbench entrypoints get CSP (M2)
  if (ext === '.html' || rel === '/index.html') {
    applySecurityHeaders(headers);
  }
  res.writeHead(200, headers);
  if (req.method !== 'HEAD') res.end(data);
  else res.end();
  return true;
}
