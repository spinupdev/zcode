import http from 'node:http';
import https from 'node:https';
import { isHostAllowed, type GitProxyOptions } from './index.js';

export interface StartedGitProxy {
  url: string;
  close(): Promise<void>;
}

const HOP_BY_HOP = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailers',
  'transfer-encoding',
  'upgrade',
  'host',
  'content-length',
]);

/**
 * isomorphic-git corsProxy format:
 *   GET/POST {proxy}/{host}{path}?{query}
 * Example: http://127.0.0.1:8787/github.com/user/repo.git/info/refs?service=git-upload-pack
 */
export async function startGitProxy(options: GitProxyOptions): Promise<StartedGitProxy> {
  const allowHosts = options.allowHosts.length
    ? options.allowHosts
    : ['github.com', 'gitlab.com', 'bitbucket.org'];

  const server = http.createServer((req, res) => {
    void handle(req, res, allowHosts);
  });

  await new Promise<void>((resolve, reject) => {
    server.listen(options.port, options.host, () => resolve());
    server.on('error', reject);
  });

  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : options.port;
  const host = options.host === '0.0.0.0' ? '127.0.0.1' : options.host;

  return {
    url: `http://${host}:${port}`,
    close: () =>
      new Promise((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}

async function handle(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  allowHosts: readonly string[],
): Promise<void> {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    setCors(res, req);
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.method === 'GET' && (req.url === '/' || req.url === '/healthz')) {
    setCors(res, req);
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true, service: 'zcode-git-proxy' }));
    return;
  }

  try {
    const target = resolveUpstream(req.url ?? '/', allowHosts);
    await proxyRequest(req, res, target);
  } catch (err) {
    const status = (err as { status?: number }).status ?? 400;
    const message = err instanceof Error ? err.message : String(err);
    setCors(res, req);
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: message }));
  }
}

function setCors(res: http.ServerResponse, req: http.IncomingMessage): void {
  const origin = req.headers.origin ?? '*';
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader(
    'Access-Control-Allow-Headers',
    req.headers['access-control-request-headers'] ??
      'Content-Type, Authorization, Accept, User-Agent',
  );
  res.setHeader('Access-Control-Expose-Headers', 'Content-Type, Content-Length, WWW-Authenticate');
  if (origin !== '*') {
    res.setHeader('Vary', 'Origin');
  }
}

export function resolveUpstream(rawUrl: string, allowHosts: readonly string[]): URL {
  // /github.com/org/repo.git/info/refs?service=...
  const u = new URL(rawUrl, 'http://git-proxy.local');
  let path = u.pathname;
  if (path.startsWith('/')) path = path.slice(1);
  if (!path) {
    throw Object.assign(new Error('missing upstream path'), { status: 400 });
  }

  // Block obvious SSRF schemes/paths
  if (path.includes('..') || path.startsWith('/')) {
    throw Object.assign(new Error('invalid path'), { status: 400 });
  }

  const hostEnd = path.indexOf('/');
  const hostname = hostEnd === -1 ? path : path.slice(0, hostEnd);
  const rest = hostEnd === -1 ? '' : path.slice(hostEnd);

  if (!hostname || hostname.includes(':') && !hostname.match(/^[^:]+:\d+$/)) {
    // allow host:port only if allowlisted parent
  }

  const hostOnly = hostname.split(':')[0]!;
  if (!isHostAllowed(hostOnly, allowHosts)) {
    throw Object.assign(new Error(`host not allowlisted: ${hostOnly}`), { status: 403 });
  }

  // Block private IP hostnames
  if (isBlockedHostname(hostOnly)) {
    throw Object.assign(new Error(`blocked host: ${hostOnly}`), { status: 403 });
  }

  const target = new URL(`https://${hostname}${rest}${u.search}`);
  return target;
}

function isBlockedHostname(host: string): boolean {
  const h = host.toLowerCase();
  if (h === 'localhost' || h.endsWith('.localhost')) return true;
  if (h === 'metadata.google.internal') return true;
  // literal IPs
  if (/^\d+\.\d+\.\d+\.\d+$/.test(h)) {
    const parts = h.split('.').map(Number);
    const [a, b] = parts;
    if (a === 10) return true;
    if (a === 127) return true;
    if (a === 0) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b! >= 16 && b! <= 31) return true;
    if (a === 192 && b === 168) return true;
  }
  return false;
}

function proxyRequest(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  target: URL,
): Promise<void> {
  return new Promise((resolve) => {
    const lib = target.protocol === 'http:' ? http : https;
    const headers: http.OutgoingHttpHeaders = {};
    for (const [k, v] of Object.entries(req.headers)) {
      if (v == null) continue;
      if (HOP_BY_HOP.has(k.toLowerCase())) continue;
      headers[k] = v;
    }
    headers.host = target.host;
    // isomorphic-git smart HTTP
    if (!headers.accept) {
      headers.accept = '*/*';
    }

    const upstream = lib.request(
      {
        protocol: target.protocol,
        hostname: target.hostname,
        port: target.port || undefined,
        path: `${target.pathname}${target.search}`,
        method: req.method,
        headers,
        timeout: 120_000,
      },
      (upRes) => {
        setCors(res, req);
        const outHeaders: http.OutgoingHttpHeaders = {};
        for (const [k, v] of Object.entries(upRes.headers)) {
          if (v == null) continue;
          if (HOP_BY_HOP.has(k.toLowerCase())) continue;
          outHeaders[k] = v;
        }
        res.writeHead(upRes.statusCode ?? 502, outHeaders);
        upRes.pipe(res);
        upRes.on('end', () => resolve());
        upRes.on('error', () => resolve());
      },
    );

    upstream.on('timeout', () => {
      upstream.destroy();
      if (!res.headersSent) {
        setCors(res, req);
        res.writeHead(504, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: 'upstream timeout' }));
      }
      resolve();
    });

    upstream.on('error', (err) => {
      if (!res.headersSent) {
        setCors(res, req);
        res.writeHead(502, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
      resolve();
    });

    if (req.method === 'POST' || req.method === 'PUT') {
      req.pipe(upstream);
    } else {
      upstream.end();
    }
  });
}
