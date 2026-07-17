/**
 * Cloudflare Worker: stateless isomorphic-git CORS proxy.
 * Mount at /git-proxy/* on the same host as the static SPA.
 *
 * isomorphic-git calls:  {origin}/git-proxy/{host}/{path}?{query}
 */

/** `*` = any public host; private/link-local still blocked in resolveUpstream. */
const DEFAULT_ALLOW = ['*', 'github.com', 'gitlab.com', 'bitbucket.org', 'codeberg.org'];
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
      // Entire custom domain was often pointed at this Worker by mistake.
      // IDE/static assets live on Cloudflare Pages — not this Worker.
      return misconfiguredHostResponse(request, url);
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
  if (allowHosts.some((a) => a === '*')) return true;
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

/**
 * Non-/git-proxy paths: this Worker is proxy-only.
 * Correct custom domain setup attaches the hostname to the **Pages** project `zcode`.
 * Worker routes (optional) must be path-scoped: `example.com/git-proxy/*`.
 */
function misconfiguredHostResponse(request: Request, url: URL): Response {
  const accept = request.headers.get('Accept') ?? '';
  const wantsHtml = accept.includes('text/html') || request.method === 'GET';
  const payload = {
    error: 'not_found',
    path: url.pathname,
    hint: 'This is the zcode-git-proxy Worker only. Point your custom domain at Cloudflare Pages project "zcode" (IDE). Use Worker route only for example.com/git-proxy/* — or rely on the Pages Function for same-origin /git-proxy.',
    expected: {
      pages: 'Cloudflare Dashboard → Pages → zcode → Custom domains → add hostname',
      workerRouteOptional: 'Workers → zcode-git-proxy → Triggers → example.com/git-proxy/*',
      healthz: `${url.origin}/git-proxy/healthz`,
    },
  };
  if (wantsHtml && request.method === 'GET') {
    const html = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"/><title>ZCode git-proxy</title>
<style>
  body{font-family:system-ui,sans-serif;max-width:40rem;margin:2rem auto;padding:0 1rem;line-height:1.5;color:#e6edf3;background:#0d1117}
  code,pre{background:#161b22;padding:0.15rem 0.4rem;border-radius:4px}
  pre{padding:0.75rem;overflow:auto}
  a{color:#58a6ff}
  h1{font-size:1.25rem}
</style></head><body>
  <h1>Wrong host routing for ZCode</h1>
  <p>This hostname is hitting the <strong>git-proxy Worker</strong>, not the <strong>Pages IDE</strong>.</p>
  <p>Path <code>${escapeHtml(url.pathname)}</code> is not under <code>/git-proxy/*</code>.</p>
  <h2>Fix (custom domain)</h2>
  <ol>
    <li>Cloudflare Dashboard → <strong>Workers</strong> → <code>zcode-git-proxy</code> → Triggers:
      remove any route like <code>${escapeHtml(url.hostname)}/*</code> that steals the whole site.</li>
    <li>Dashboard → <strong>Pages</strong> → project <code>zcode</code> → <strong>Custom domains</strong>
      → add <code>${escapeHtml(url.hostname)}</code>.</li>
    <li>Optional: Worker route only <code>${escapeHtml(url.hostname)}/git-proxy/*</code>
      (Pages Function already serves same-origin <code>/git-proxy</code> on the Pages domain).</li>
  </ol>
  <p>Check proxy: <a href="/git-proxy/healthz"><code>/git-proxy/healthz</code></a>
    (works when this Worker is mounted correctly).</p>
  <pre>${escapeHtml(JSON.stringify(payload, null, 2))}</pre>
</body></html>`;
    return new Response(html, {
      status: 404,
      headers: {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-store',
      },
    });
  }
  return json(payload, 404, request);
}

function escapeHtml(s: string): string {
  return s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}
