/**
 * Cookie-authorized reverse proxy to a local REH process (R3b).
 *
 * Browser never sees the connection token (KD12). After password login, the
 * HttpOnly session cookie is required; we inject the internal token only on
 * the hop to REH (query + header for compatibility).
 */
import http from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Duplex } from 'node:stream';
import type { CookieTokenBridge } from '../auth/cookie-bridge.js';

export interface RehProxyTarget {
  /** e.g. http://127.0.0.1:8081 */
  endpoint: string;
  /** Internal VS Code --connection-token (never sent to browser) */
  connectionToken: string;
}

export interface RehProxyOptions {
  bridge: CookieTokenBridge;
  /** Live REH target; return null when not running */
  getTarget: () => RehProxyTarget | null;
  /**
   * Paths owned by the ZCode shell — never reverse-proxied to REH.
   * Matched as prefix or exact.
   */
  reservedPathPrefixes?: string[];
}

const DEFAULT_RESERVED = [
  '/healthz',
  '/readyz',
  '/login',
  '/logout',
  '/v1/',
  '/git-proxy',
  '/debug', // DEV SPA dogfood
  '/vscode',
  '/extensions',
  '/product.json',
  '/bootstrap.js',
  '/index.html',
  // Product workbench owns `/` (static shell); REH remote paths are not reserved
];

export function isReservedPath(pathname: string, reserved = DEFAULT_RESERVED): boolean {
  if (pathname === '/' || pathname === '') return true;
  for (const p of reserved) {
    // Match exact path or as a path prefix with a following slash.
    // Avoid treating /vscode-remote-resource as /vscode (require `/` after prefix).
    // If reserved entry already ends with `/`, use startsWith(p) only.
    if (pathname === p) return true;
    if (p.endsWith('/')) {
      if (pathname.startsWith(p)) return true;
    } else if (pathname.startsWith(`${p}/`)) {
      return true;
    }
  }
  return false;
}

/**
 * Normalize upstream query for REH.
 * - Strip client-supplied tkn/connectionToken (never trust browser for secrets).
 * - When REH runs with a mandatory token (ZCODE_REH_REQUIRE_TOKEN=1), inject
 *   VS Code's query name `tkn` (see connectionTokenQueryName).
 * - Default REH uses --without-connection-token (loopback + cookie proxy).
 */
function injectToken(pathAndQuery: string, token: string): string {
  const qIndex = pathAndQuery.indexOf('?');
  const pathname = qIndex === -1 ? pathAndQuery : pathAndQuery.slice(0, qIndex);
  const search = qIndex === -1 ? '' : pathAndQuery.slice(qIndex + 1);
  const params = new URLSearchParams(search);
  params.delete('connectionToken');
  params.delete('tkn');
  params.delete('token');
  // Only inject when we still use a mandatory token on REH
  if (process.env.ZCODE_REH_REQUIRE_TOKEN === '1' && token) {
    params.set('tkn', token);
  }
  const qs = params.toString();
  return qs ? `${pathname}?${qs}` : pathname;
}

/**
 * HTTP reverse proxy to REH when the request is authenticated and not a shell route.
 * Returns true if the request was handled (proxied or 401).
 */
export function tryProxyHttp(
  req: IncomingMessage,
  res: ServerResponse,
  opts: RehProxyOptions,
): boolean {
  const target = opts.getTarget();
  if (!target) return false;

  const host = req.headers.host ?? 'localhost';
  const url = new URL(req.url ?? '/', `http://${host}`);
  const reserved = opts.reservedPathPrefixes ?? DEFAULT_RESERVED;
  if (isReservedPath(url.pathname, reserved)) return false;

  const token = opts.bridge.resolveConnectionToken(req.headers.cookie);
  if (!token || token !== target.connectionToken) {
    // Only claim REH-looking paths; leave others to shell 404/login
    if (!looksLikeRehPath(url.pathname)) return false;
    res.writeHead(401, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'unauthorized', login: '/login' }));
    return true;
  }

  const upstream = new URL(target.endpoint);
  const path = injectToken(url.pathname + url.search, target.connectionToken);
  const headers = { ...req.headers, host: upstream.host } as http.OutgoingHttpHeaders;
  delete headers['connection'];
  delete headers['x-vscode-connection-token'];
  if (process.env.ZCODE_REH_REQUIRE_TOKEN === '1') {
    headers['x-vscode-connection-token'] = target.connectionToken;
  }

  const proxyReq = http.request(
    {
      protocol: upstream.protocol,
      hostname: upstream.hostname,
      port: upstream.port,
      path,
      method: req.method,
      headers,
    },
    (proxyRes) => {
      res.writeHead(proxyRes.statusCode ?? 502, proxyRes.headers);
      proxyRes.pipe(res);
    },
  );
  proxyReq.on('error', (err) => {
    if (!res.headersSent) {
      res.writeHead(502, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'reh_unreachable', message: String(err) }));
    } else {
      res.destroy(err);
    }
  });
  req.pipe(proxyReq);
  return true;
}

/** WebSocket upgrade → REH (cookie-auth). */
export function handleRehUpgrade(
  req: IncomingMessage,
  socket: Duplex,
  head: Buffer,
  opts: RehProxyOptions,
): boolean {
  const target = opts.getTarget();
  if (!target) return false;

  const host = req.headers.host ?? 'localhost';
  const url = new URL(req.url ?? '/', `http://${host}`);
  const reserved = opts.reservedPathPrefixes ?? DEFAULT_RESERVED;
  // Allow WS on `/` and other non-reserved paths (VS Code remote uses authority root)
  if (isReservedPath(url.pathname, reserved) && url.pathname !== '/') {
    // Shell static never upgrades
    return false;
  }

  const token = opts.bridge.resolveConnectionToken(req.headers.cookie);
  if (!token || token !== target.connectionToken) {
    socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
    socket.destroy();
    return true;
  }

  const upstream = new URL(target.endpoint);
  const path = injectToken(url.pathname + url.search, target.connectionToken);
  const headers = { ...req.headers, host: upstream.host } as http.OutgoingHttpHeaders;

  const proxyReq = http.request({
    protocol: upstream.protocol,
    hostname: upstream.hostname,
    port: upstream.port,
    path,
    method: 'GET',
    headers: {
      ...headers,
      connection: 'Upgrade',
      upgrade: 'websocket',
      ...(process.env.ZCODE_REH_REQUIRE_TOKEN === '1'
        ? { 'x-vscode-connection-token': target.connectionToken }
        : {}),
    },
  });

  proxyReq.on('upgrade', (proxyRes, proxySocket, proxyHead) => {
    const lines = [
      `HTTP/1.1 ${proxyRes.statusCode ?? 101} ${proxyRes.statusMessage ?? 'Switching Protocols'}`,
    ];
    for (const [k, v] of Object.entries(proxyRes.headers)) {
      if (v == null) continue;
      if (Array.isArray(v)) {
        for (const item of v) lines.push(`${k}: ${item}`);
      } else {
        lines.push(`${k}: ${v}`);
      }
    }
    lines.push('', '');
    socket.write(lines.join('\r\n'));
    if (proxyHead.length) socket.write(proxyHead);
    if (head.length) proxySocket.write(head);
    proxySocket.pipe(socket);
    socket.pipe(proxySocket);
    proxySocket.on('error', () => socket.destroy());
    socket.on('error', () => proxySocket.destroy());
  });

  proxyReq.on('error', () => {
    try {
      socket.write('HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n');
    } catch {
      /* ignore */
    }
    socket.destroy();
  });

  // Some Node versions require end() to flush the upgrade request
  proxyReq.end();
  return true;
}

function looksLikeRehPath(pathname: string): boolean {
  return (
    pathname.startsWith('/vscode-remote-resource') ||
    pathname.startsWith('/version') ||
    pathname.startsWith('/stable-') ||
    pathname.startsWith('/oss-dev') ||
    pathname.includes('webWorkerExtensionHostIframe') ||
    pathname.startsWith('/static/')
  );
}

export { DEFAULT_RESERVED };
