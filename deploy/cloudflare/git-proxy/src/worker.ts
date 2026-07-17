/**
 * Cloudflare Worker: stateless isomorphic-git CORS proxy.
 * Mount at /git-proxy/* on the same host as the static SPA.
 *
 * isomorphic-git calls:  {origin}/git-proxy/{host}/{path}?{query}
 */

const DEFAULT_ALLOW = ['github.com', 'gitlab.com', 'bitbucket.org'];
const PREFIX = '/git-proxy';

export interface Env {
  ALLOW_HOSTS?: string;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(request) });
    }

    if (!matchesPrefix(url.pathname)) {
      return json({ error: 'not_found', hint: 'mount this worker at /git-proxy/*' }, 404, request);
    }

    const stripped = stripPrefix(url.pathname + url.search);
    const pathOnly = stripped.split('?')[0] || '/';

    if (request.method === 'GET' && (pathOnly === '/' || pathOnly === '/healthz')) {
      return json(
        { ok: true, service: 'zcode-git-proxy', prefix: PREFIX, mode: 'stateless', runtime: 'cloudflare-worker' },
        200,
        request,
      );
    }

    try {
      const allow = parseAllow(env.ALLOW_HOSTS);
      const target = resolveUpstream(stripped, allow);
      return await proxyFetch(request, target);
    } catch (err) {
      const status = (err as { status?: number }).status ?? 400;
      const message = err instanceof Error ? err.message : String(err);
      return json({ error: message }, status, request);
    }
  },
};

function parseAllow(raw?: string): string[] {
  if (!raw?.trim()) return DEFAULT_ALLOW;
  return raw.split(',').map((s) => s.trim()).filter(Boolean);
}

function matchesPrefix(pathname: string): boolean {
  return pathname === PREFIX || pathname.startsWith(`${PREFIX}/`);
}

function stripPrefix(pathAndQuery: string): string {
  if (pathAndQuery === PREFIX || pathAndQuery === `${PREFIX}/`) return '/';
  if (pathAndQuery.startsWith(`${PREFIX}/`)) return pathAndQuery.slice(PREFIX.length);
  return pathAndQuery;
}

function isHostAllowed(hostname: string, allowHosts: string[]): boolean {
  const host = hostname.toLowerCase();
  return allowHosts.some((a) => host === a.toLowerCase() || host.endsWith(`.${a.toLowerCase()}`));
}

function isBlockedHostname(host: string): boolean {
  const h = host.toLowerCase();
  if (h === 'localhost' || h.endsWith('.localhost')) return true;
  if (h === 'metadata.google.internal') return true;
  if (/^\d+\.\d+\.\d+\.\d+$/.test(h)) {
    const [a, b] = h.split('.').map(Number);
    if (a === 10 || a === 127 || a === 0) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b! >= 16 && b! <= 31) return true;
    if (a === 192 && b === 168) return true;
  }
  return false;
}

function resolveUpstream(rawUrl: string, allowHosts: string[]): URL {
  const u = new URL(rawUrl, 'http://git-proxy.local');
  let path = u.pathname;
  if (path.startsWith('/')) path = path.slice(1);
  if (!path) throw Object.assign(new Error('missing upstream path'), { status: 400 });
  if (path.includes('..')) throw Object.assign(new Error('invalid path'), { status: 400 });

  const hostEnd = path.indexOf('/');
  const hostname = hostEnd === -1 ? path : path.slice(0, hostEnd);
  const rest = hostEnd === -1 ? '' : path.slice(hostEnd);
  const hostOnly = hostname.split(':')[0]!;

  if (!isHostAllowed(hostOnly, allowHosts)) {
    throw Object.assign(new Error(`host not allowlisted: ${hostOnly}`), { status: 403 });
  }
  if (isBlockedHostname(hostOnly)) {
    throw Object.assign(new Error(`blocked host: ${hostOnly}`), { status: 403 });
  }
  return new URL(`https://${hostname}${rest}${u.search}`);
}

async function proxyFetch(request: Request, target: URL): Promise<Response> {
  const headers = new Headers(request.headers);
  headers.delete('host');
  headers.set('host', target.host);
  if (!headers.has('accept')) headers.set('accept', '*/*');

  const init: RequestInit = {
    method: request.method,
    headers,
    redirect: 'follow',
  };
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    init.body = request.body;
    // @ts-expect-error duplex required for streaming body in some runtimes
    init.duplex = 'half';
  }

  const upstream = await fetch(target.toString(), init);
  const out = new Headers(upstream.headers);
  const cors = corsHeaders(request);
  cors.forEach((v, k) => out.set(k, v));
  return new Response(upstream.body, { status: upstream.status, headers: out });
}

function corsHeaders(request: Request): Headers {
  const h = new Headers();
  const origin = request.headers.get('Origin') ?? '*';
  h.set('Access-Control-Allow-Origin', origin);
  h.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  h.set(
    'Access-Control-Allow-Headers',
    request.headers.get('Access-Control-Request-Headers') ??
      'Content-Type, Authorization, Accept, User-Agent',
  );
  h.set('Access-Control-Expose-Headers', 'Content-Type, Content-Length, WWW-Authenticate');
  if (origin !== '*') h.set('Vary', 'Origin');
  return h;
}

function json(body: unknown, status: number, request: Request): Response {
  const h = corsHeaders(request);
  h.set('content-type', 'application/json; charset=utf-8');
  return new Response(JSON.stringify(body), { status, headers: h });
}
