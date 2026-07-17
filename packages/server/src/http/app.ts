import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  createGitProxyHandler,
  DEFAULT_ALLOW_HOSTS,
  DEFAULT_GIT_PROXY_PREFIX,
} from '@zcode/git-proxy';
import { buildWorkbenchCreateOptions } from '@zcode/shell';
import { CookieTokenBridge, SESSION_COOKIE } from '../auth/cookie-bridge.js';
import { type PasswordVerifier, LoginRateLimiter } from '../auth/password.js';
import { tryProxyHttp } from '../reh/proxy.js';
import { applySecurityHeaders } from './csp.js';
import { tryServeStatic } from './static.js';

export interface AppContext {
  bridge: CookieTokenBridge;
  passwords: PasswordVerifier;
  limiter: LoginRateLimiter;
  connectionToken: string;
  authority: string;
  secureCookies: boolean;
  staticDir?: string;
  /** dist/vscode-web */
  vscodeWebDir?: string;
  /** apps/workbench/dist */
  workbenchDir?: string;
  /** monorepo extensions/ */
  extensionsDir?: string;
  rehEndpoint?: string;
  rehMode?: string;
  /** Mount isomorphic-git corsProxy at this path (default /git-proxy). Set false to disable. */
  gitProxy?: boolean | { prefix?: string; allowHosts?: string[] };
  productOverlay?: Record<string, unknown>;
  /** When true and REH is up, unauthenticated shell still serves login; REH via cookie proxy */
  rehProxyEnabled?: boolean;
  /** Absolute workspace path opened on REH (for remote folderUri) */
  workspacePath?: string;
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
          /** Same-origin authority for remoteAuthority (REH is proxied; no token in body) */
          authority: authed ? ctx.authority : null,
          ready: authed,
          reh: ctx.rehMode ?? 'none',
          rehProxy: Boolean(ctx.rehEndpoint),
          workbench: Boolean(ctx.workbenchDir || ctx.staticDir),
          /** Absolute path REH opened — use as vscode-remote folderUri.path */
          workspacePath: authed ? ctx.workspacePath ?? null : null,
        });
        return;
      }

      if (req.method === 'POST' && url.pathname === '/login') {
        await handleLogin(req, res, ctx);
        return;
      }

      // Login form always available
      if (req.method === 'GET' && (url.pathname === '/login' || url.pathname === '/login/')) {
        html(
          res,
          200,
          loginPage(ctx.bridge.isAuthenticated(req.headers.cookie), ctx.authority, ctx),
        );
        return;
      }

      if (req.method === 'POST' && url.pathname === '/logout') {
        ctx.bridge.revokeFromCookie(req.headers.cookie);
        res.setHeader('Set-Cookie', ctx.bridge.clearCookie({ secure: ctx.secureCookies }));
        json(res, 200, { ok: true });
        return;
      }

      // Dual-mode product (canonical /product.json + legacy /ide/product.json)
      if (url.pathname === '/ide/product.json' || url.pathname === '/product.json') {
        serveIdeProduct(res, url, ctx);
        return;
      }

      // Legacy /ide → product root
      if (url.pathname === '/ide' || url.pathname === '/ide/') {
        res.writeHead(302, {
          Location: `/${url.search}`,
          'cache-control': 'no-store',
          'x-zcode-ide-legacy': '1',
        });
        res.end();
        return;
      }
      if (url.pathname.startsWith('/ide/') && ctx.workbenchDir) {
        const rel = url.pathname.slice('/ide'.length);
        if (tryServeStatic(req, res, ctx.workbenchDir, rel)) return;
        res.writeHead(302, {
          Location: `${rel}${url.search}`,
          'cache-control': 'no-store',
        });
        res.end();
        return;
      }

      if (url.pathname.startsWith('/vscode/') && ctx.vscodeWebDir) {
        const rel = url.pathname.slice('/vscode'.length);
        if (tryServeStatic(req, res, ctx.vscodeWebDir, rel)) return;
      }
      if (url.pathname.startsWith('/extensions/') && ctx.extensionsDir) {
        const rel = url.pathname.slice('/extensions'.length);
        if (tryServeStatic(req, res, ctx.extensionsDir, rel)) return;
      }

      // Debug SPA at /debug/ (DEV only — staticDir only set when spaDebug enabled)
      if (ctx.staticDir && (url.pathname === '/debug' || url.pathname.startsWith('/debug/'))) {
        const rel =
          url.pathname === '/debug' || url.pathname === '/debug/'
            ? '/index.html'
            : url.pathname.slice('/debug'.length);
        if (tryServeStatic(req, res, ctx.staticDir, rel)) return;
        if (tryServeStatic(req, res, ctx.staticDir, '/index.html')) return;
      }

      // Product IDE at `/` + workbench assets (bootstrap.js, …)
      if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
        if (ctx.workbenchDir && tryServeStatic(req, res, ctx.workbenchDir, '/index.html')) {
          return;
        }
        // Authenticated shell without workbench: login landing
        html(
          res,
          200,
          loginPage(ctx.bridge.isAuthenticated(req.headers.cookie), ctx.authority, ctx),
        );
        return;
      }

      if (ctx.workbenchDir && tryServeStatic(req, res, ctx.workbenchDir, url.pathname)) {
        return;
      }

      // R3b: cookie-authorized reverse proxy to local REH for remote mode
      if (
        ctx.rehProxyEnabled !== false &&
        ctx.rehEndpoint &&
        tryProxyHttp(req, res, {
          bridge: ctx.bridge,
          getTarget: () =>
            ctx.rehEndpoint
              ? { endpoint: ctx.rehEndpoint, connectionToken: ctx.connectionToken }
              : null,
        })
      ) {
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
    // Product IDE is at /; debug SPA lives under /debug/
    const dest = '/?ready=1';
    res.writeHead(303, { Location: dest });
    res.end();
    return;
  }

  json(res, 200, {
    ok: true,
    authority: ctx.authority,
    cookie: SESSION_COOKIE,
    redirect: '/?ready=1',
  });
}

function json(res: ServerResponse, status: number, body: unknown): void {
  const data = JSON.stringify(body);
  const headers: Record<string, string | number | string[]> = {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  };
  res.writeHead(status, headers);
  res.end(data);
}

function html(res: ServerResponse, status: number, body: string): void {
  const headers: Record<string, string | number | string[]> = {
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'no-store',
  };
  applySecurityHeaders(headers);
  res.writeHead(status, headers);
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

function serveIdeProduct(res: ServerResponse, url: URL, ctx: AppContext): void {
  const modeParam = url.searchParams.get('mode');
  const remoteAuth =
    url.searchParams.get('authority') ?? url.searchParams.get('remoteAuthority') ?? undefined;
  const mode =
    modeParam === 'remote' || (modeParam !== 'browser' && remoteAuth) ? 'remote' : 'browser';
  const origin = `${url.protocol}//${url.host}`;
  const remotePath =
    url.searchParams.get('path') ||
    ctx.workspacePath ||
    '/home/workspace';
  const body = buildWorkbenchCreateOptions({
    mode,
    remoteAuthority: mode === 'remote' ? remoteAuth ?? ctx.authority : undefined,
    workspaceId: url.searchParams.get('workspace') || 'default',
    remoteWorkspacePath: remotePath,
    productOverlay: ctx.productOverlay as
      | import('@zcode/shell').ProductOverlay
      | undefined,
    origin,
    connectionReady: mode === 'remote' ? true : undefined,
  });
  json(res, 200, body);
}

function loginPage(authenticated: boolean, authority: string, ctx: AppContext): string {
  if (authenticated) {
    const appLink = ctx.staticDir
      ? `<p><a href="/debug/">Open debug SPA workspace</a> <small>(DEV only — not in production)</small></p>`
      : '';
    const ideLink = ctx.workbenchDir
      ? `<p><a href="/">Open VS Code Web IDE (browser)</a> · <a href="/?mode=remote&authority=${encodeURIComponent(authority)}&ready=1">Remote mode (cookie-auth REH proxy)</a></p>`
      : `<p>IDE: run <code>./scripts/fetch-vscode-web.sh</code> and rebuild workbench.</p>`;
    return `<!DOCTYPE html><html><body>
      <h1>ZCode server</h1>
      <p>Authenticated. authority=<code>${escapeHtml(authority)}</code></p>
      <p>REH mode: <code>${escapeHtml(ctx.rehMode ?? 'none')}</code></p>
      ${ideLink}
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
    <p>After sign-in, open <a href="/">browser IDE</a> or remote mode from the next screen.</p>
  </body></html>`;
}

function escapeHtml(s: string): string {
  return s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}
