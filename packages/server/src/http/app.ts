import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  createGitProxyHandler,
  DEFAULT_ALLOW_HOSTS,
  DEFAULT_GIT_PROXY_PREFIX,
} from '@zcode/git-proxy';
import { CookieTokenBridge, SESSION_COOKIE } from '../auth/cookie-bridge.js';
import { type PasswordVerifier, LoginRateLimiter } from '../auth/password.js';
import { tryServeStatic } from './static.js';

export interface AppContext {
  bridge: CookieTokenBridge;
  passwords: PasswordVerifier;
  limiter: LoginRateLimiter;
  connectionToken: string;
  authority: string;
  secureCookies: boolean;
  staticDir?: string;
  rehEndpoint?: string;
  rehMode?: string;
  /** Mount isomorphic-git corsProxy at this path (default /git-proxy). Set false to disable. */
  gitProxy?: boolean | { prefix?: string; allowHosts?: string[] };
}

export function createRequestHandler(ctx: AppContext) {
  const gitProxyEnabled = ctx.gitProxy !== false;
  const gitProxyOpts =
    typeof ctx.gitProxy === 'object' && ctx.gitProxy
      ? ctx.gitProxy
      : { prefix: DEFAULT_GIT_PROXY_PREFIX, allowHosts: [...DEFAULT_ALLOW_HOSTS] };
  const gitProxyHandler = gitProxyEnabled
    ? createGitProxyHandler({
        prefix: gitProxyOpts.prefix ?? DEFAULT_GIT_PROXY_PREFIX,
        allowHosts: gitProxyOpts.allowHosts ?? DEFAULT_ALLOW_HOSTS,
      })
    : null;

  return async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const host = req.headers.host ?? 'localhost';
    const url = new URL(req.url ?? '/', `http://${host}`);

    try {
      // Same-origin git CORS proxy (stateless) — before auth/static
      if (gitProxyHandler && (await gitProxyHandler(req, res))) {
        return;
      }

      if (req.method === 'GET' && (url.pathname === '/healthz' || url.pathname === '/readyz')) {
        json(res, 200, {
          ok: true,
          reh: ctx.rehMode ?? 'none',
          rehEndpoint: ctx.rehEndpoint ? true : false,
          gitProxy: gitProxyEnabled
            ? gitProxyOpts.prefix ?? DEFAULT_GIT_PROXY_PREFIX
            : false,
        });
        return;
      }

      if (req.method === 'GET' && url.pathname === '/v1/session') {
        const authed = ctx.bridge.isAuthenticated(req.headers.cookie);
        json(res, 200, {
          authenticated: authed,
          authority: authed ? ctx.authority : null,
          reh: ctx.rehMode ?? 'none',
          workbench: ctx.staticDir ? true : false,
        });
        return;
      }

      if (req.method === 'POST' && url.pathname === '/login') {
        await handleLogin(req, res, ctx);
        return;
      }

      if (req.method === 'POST' && url.pathname === '/logout') {
        ctx.bridge.revokeFromCookie(req.headers.cookie);
        res.setHeader('Set-Cookie', ctx.bridge.clearCookie({ secure: ctx.secureCookies }));
        json(res, 200, { ok: true });
        return;
      }

      // Static workbench / browser app (same-origin MVP)
      if (ctx.staticDir && tryServeStatic(req, res, ctx.staticDir, url.pathname)) {
        return;
      }

      if (req.method === 'GET' && url.pathname === '/') {
        html(
          res,
          200,
          loginPage(ctx.bridge.isAuthenticated(req.headers.cookie), ctx.authority, ctx),
        );
        return;
      }

      json(res, 404, { error: 'not_found' });
    } catch (err) {
      const status = (err as { status?: number }).status ?? 500;
      const message = err instanceof Error ? err.message : String(err);
      json(res, status, { error: message });
    }
  };
}

async function handleLogin(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: AppContext,
): Promise<void> {
  const ip = req.socket.remoteAddress ?? 'unknown';
  ctx.limiter.assertAllowed(ip);

  const body = await readBody(req);
  let password = '';
  const ct = req.headers['content-type'] ?? '';
  if (ct.includes('application/json')) {
    const parsed = JSON.parse(body || '{}') as { password?: string };
    password = parsed.password ?? '';
  } else {
    const params = new URLSearchParams(body);
    password = params.get('password') ?? '';
  }

  if (!ctx.passwords.verify(password)) {
    ctx.limiter.recordFailure(ip);
    json(res, 401, { error: 'invalid_password' });
    return;
  }

  ctx.limiter.recordSuccess(ip);
  const session = ctx.bridge.createSession(ctx.connectionToken);
  res.setHeader(
    'Set-Cookie',
    ctx.bridge.buildSetCookie(session.cookieValue, {
      secure: ctx.secureCookies,
      maxAgeSec: Math.floor((session.expiresAt - Date.now()) / 1000),
    }),
  );

  if (ct.includes('application/x-www-form-urlencoded')) {
    const dest = ctx.staticDir ? '/index.html' : '/?ready=1';
    res.writeHead(303, { Location: dest });
    res.end();
    return;
  }

  json(res, 200, {
    ok: true,
    authority: ctx.authority,
    cookie: SESSION_COOKIE,
    redirect: ctx.staticDir ? '/index.html' : '/?ready=1',
  });
}

function json(res: ServerResponse, status: number, body: unknown): void {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  res.end(data);
}

function html(res: ServerResponse, status: number, body: string): void {
  res.writeHead(status, {
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'no-store',
  });
  res.end(body);
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function loginPage(authenticated: boolean, authority: string, ctx: AppContext): string {
  if (authenticated) {
    const appLink = ctx.staticDir
      ? `<p><a href="/index.html">Open browser workspace</a></p>`
      : '';
    return `<!DOCTYPE html><html><body>
      <h1>ZCode server</h1>
      <p>Authenticated. authority=<code>${escapeHtml(authority)}</code></p>
      <p>REH mode: <code>${escapeHtml(ctx.rehMode ?? 'none')}</code></p>
      ${appLink}
      <form method="post" action="/logout"><button type="submit">Log out</button></form>
    </body></html>`;
  }
  return `<!DOCTYPE html><html><body>
    <h1>ZCode login</h1>
    <form method="post" action="/login" enctype="application/x-www-form-urlencoded">
      <label>Password <input type="password" name="password" autocomplete="current-password" /></label>
      <button type="submit">Sign in</button>
    </form>
    <p>Session cookie is HttpOnly. Connection token never appears in the URL.</p>
  </body></html>`;
}

function escapeHtml(s: string): string {
  return s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}
