/**
 * R6 cookie-proxy flow without a real REH binary:
 * login → session → authenticated proxy hop (mock REH /version).
 *
 * Full terminal `echo ok` against a real REH is in e2e/tests/reh-terminal.spec.ts
 * and requires dist/server from R2c.
 */
import assert from 'node:assert/strict';
import http from 'node:http';
import { describe, it } from 'node:test';
import { CookieTokenBridge } from '../auth/cookie-bridge.js';
import { tryProxyHttp } from './proxy.js';
import { waitForUrl } from './wait.js';

describe('R6 terminal proxy flow (mock REH)', () => {
  it('login cookie authorizes REH /version (terminal stack prerequisite)', async () => {
    const connectionToken = 'internal-reh-token-r6';
    const bridge = new CookieTokenBridge('r6-test-secret');

    // Mock REH: answers /version (used by workbench / health probes)
    const reh = http.createServer((req, res) => {
      const url = req.url ?? '';
      if (url.startsWith('/version')) {
        if (!url.includes('connectionToken=')) {
          res.writeHead(403).end('missing token');
          return;
        }
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ version: '1.129.0-mock', quality: 'oss' }));
        return;
      }
      res.writeHead(404).end('not found');
    });
    await new Promise<void>((r) => reh.listen(0, '127.0.0.1', () => r()));
    const rehPort = (reh.address() as { port: number }).port;

    const front = http.createServer((req, res) => {
      // Minimal login
      if (req.method === 'POST' && req.url === '/login') {
        const session = bridge.createSession(connectionToken);
        res.writeHead(200, {
          'content-type': 'application/json',
          'set-cookie': bridge.buildSetCookie(session.cookieValue, { maxAgeSec: 3600 }),
        });
        res.end(JSON.stringify({ ok: true, authority: '127.0.0.1:0' }));
        return;
      }
      if (req.method === 'GET' && req.url === '/healthz') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: true, reh: 'artifact', rehEndpoint: true }));
        return;
      }
      const handled = tryProxyHttp(req, res, {
        bridge,
        getTarget: () => ({
          endpoint: `http://127.0.0.1:${rehPort}`,
          connectionToken,
        }),
      });
      if (!handled) {
        res.writeHead(404).end('no');
      }
    });
    await new Promise<void>((r) => front.listen(0, '127.0.0.1', () => r()));
    const frontPort = (front.address() as { port: number }).port;
    const base = `http://127.0.0.1:${frontPort}`;

    try {
      await waitForUrl(`${base}/healthz`, { timeoutMs: 3_000, intervalMs: 50 });

      const login = await fetch(`${base}/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ password: 'any' }),
      });
      assert.equal(login.status, 200);
      const setCookie = login.headers.getSetCookie?.() ?? [];
      const cookieLine =
        setCookie.find((c) => c.startsWith('zcode_sess=')) ??
        login.headers.get('set-cookie') ??
        '';
      assert.match(cookieLine, /zcode_sess=/);
      assert.equal(cookieLine.includes(connectionToken), false);
      const cookie = cookieLine.split(';')[0]!;

      // Unauthenticated REH path → 401
      const denied = await fetch(`${base}/version`);
      assert.equal(denied.status, 401);

      // Authenticated → mock REH with injected token
      const version = await fetch(`${base}/version`, { headers: { cookie } });
      assert.equal(version.status, 200);
      const body = (await version.json()) as { version: string };
      assert.match(body.version, /mock/);
    } finally {
      await new Promise<void>((r) => front.close(() => r()));
      await new Promise<void>((r) => reh.close(() => r()));
    }
  });
});
