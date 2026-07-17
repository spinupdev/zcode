import type { IncomingMessage, ServerResponse } from 'node:http';
import http from 'node:http';
import https from 'node:https';
import {
  DEFAULT_ALLOW_HOSTS,
  DEFAULT_GIT_PROXY_PREFIX,
  matchesProxyPrefix,
  resolveUpstream,
  stripProxyPrefix,
} from './allowlist.js';

export interface GitProxyHandlerOptions {
  /** URL mount prefix, e.g. `/git-proxy`. Use `''` for root (standalone proxy). */
  prefix?: string;
  allowHosts?: readonly string[];
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
 * Node HTTP handler for git CORS proxy (mountable under a path prefix).
 * Returns true if the request was handled.
 */
export function createGitProxyHandler(options: GitProxyHandlerOptions = {}) {
  const prefix = options.prefix ?? DEFAULT_GIT_PROXY_PREFIX;
  const allowHosts = options.allowHosts?.length
    ? options.allowHosts
    : DEFAULT_ALLOW_HOSTS;

  return async function handleGitProxy(
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<boolean> {
    const rawUrl = req.url ?? '/';
    const pathOnly = rawUrl.split('?')[0] ?? '/';

    // When prefix is empty, handle all requests on this server
    if (prefix) {
      if (!matchesProxyPrefix(pathOnly, prefix)) {
        return false;
      }
    }

    const stripped = prefix ? stripProxyPrefix(rawUrl, prefix) : rawUrl;
    await dispatch(req, res, stripped, allowHosts, prefix || '/');
    return true;
  };
}

async function dispatch(
  req: IncomingMessage,
  res: ServerResponse,
  strippedUrl: string,
  allowHosts: readonly string[],
  healthBase: string,
): Promise<void> {
  if (req.method === 'OPTIONS') {
    setCors(res, req);
    res.writeHead(204);
    res.end();
    return;
  }

  const pathOnly = (strippedUrl.split('?')[0] ?? '/') || '/';
  if (
    req.method === 'GET' &&
    (pathOnly === '/' || pathOnly === '' || pathOnly === '/healthz')
  ) {
    setCors(res, req);
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(
      JSON.stringify({
        ok: true,
        service: 'zcode-git-proxy',
        prefix: healthBase,
        mode: 'stateless',
      }),
    );
    return;
  }

  try {
    const target = resolveUpstream(strippedUrl.startsWith('/') ? strippedUrl : `/${strippedUrl}`, [
      ...allowHosts,
    ]);
    await proxyRequest(req, res, target);
  } catch (err) {
    const status = (err as { status?: number }).status ?? 400;
    const message = err instanceof Error ? err.message : String(err);
    setCors(res, req);
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: message }));
  }
}

function setCors(res: ServerResponse, req: IncomingMessage): void {
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

function proxyRequest(
  req: IncomingMessage,
  res: ServerResponse,
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
