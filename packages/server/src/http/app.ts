import type { IncomingMessage, ServerResponse } from 'node:http';
import { CookieTokenBridge, SESSION_COOKIE } from '../auth/cookie-bridge.js';
import {
  type PasswordVerifier,
  LoginRateLimiter,
} from '../auth/password.js';

export interface AppContext {
  bridge: CookieTokenBridge;
  passwords: PasswordVerifier;
  limiter: LoginRateLimiter;
  /** Internal connection token for VS Code server process */
  connectionToken: string;
  authority: string;
  secureCookies: boolean;
}

export function createRequestHandler(ctx: AppContext) {
  return async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const host = req.headers.host ?? 'localhost';
    const url = new URL(req.url ?? '/', `http://${host}`);

    try {
      if (req.method === 'GET' && (url.pathname === '/healthz' || url.pathname === '/readyz')) {
        json(res, 200, { ok: true });
        return;
      }

      if (req.method === 'GET' && url.pathname === '/v1/session') {
        const authed = ctx.bridge.isAuthenticated(req.headers.cookie);
        json(res, 200, {
          authenticated: authed,
          authority: authed ? ctx.authority : null,
          // never include connectionToken
        });
        return;
      }

      if (req.method === 'POST' && url.pathname === '/login') {
        await handleLogin(req, res, ctx, url);
        return;
      }

      if (req.method === 'POST' && url.pathname === '/logout') {
        ctx.bridge.revokeFromCookie(req.headers.cookie);
        res.setHeader('Set-Cookie', ctx.bridge.clearCookie({ secure: ctx.secureCookies }));
        json(res, 200, { ok: true });
        return;
      }

      if (req.method === 'GET' && url.pathname === '/') {
        html(
          res,
          200,
          loginPage(ctx.bridge.isAuthenticated(req.headers.cookie), ctx.authority),
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
  url: URL,
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

  // Prefer clean redirect — no secrets in query
  if (ct.includes('application/x-www-form-urlencoded')) {
    res.writeHead(303, { Location: `/?ready=1` });
    res.end();
    return;
  }

  json(res, 200, {
    ok: true,
    authority: ctx.authority,
    cookie: SESSION_COOKIE,
    // connectionToken intentionally omitted
  });
  void url;
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

function loginPage(authenticated: boolean, authority: string): string {
  if (authenticated) {
    return `<!DOCTYPE html><html><body>
      <h1>ZCode server</h1>
      <p>Authenticated. authority=<code>${escapeHtml(authority)}</code></p>
      <p>Workbench co-serve + REH attach lands next (R3 continue / M1).</p>
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
