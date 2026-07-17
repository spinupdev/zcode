import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { startServer } from './start.js';

describe('startServer login flow', () => {
  it('healthz and login set HttpOnly cookie without returning token', async () => {
    const srv = await startServer({
      host: '127.0.0.1',
      port: 0,
      workspace: '/tmp',
      password: 'test-pass',
    });

    try {
      const health = await fetch(new URL('healthz', srv.url));
      assert.equal(health.status, 200);

      const bad = await fetch(new URL('login', srv.url), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ password: 'wrong' }),
      });
      assert.equal(bad.status, 401);

      const ok = await fetch(new URL('login', srv.url), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ password: 'test-pass' }),
      });
      assert.equal(ok.status, 200);
      const body = (await ok.json()) as { ok: boolean; authority: string; connectionToken?: string };
      assert.equal(body.ok, true);
      assert.equal(body.connectionToken, undefined);
      assert.ok(body.authority.includes('127.0.0.1'));

      const setCookie = ok.headers.getSetCookie?.() ?? [];
      const cookieLine =
        setCookie.find((c) => c.startsWith('zcode_sess=')) ??
        ok.headers.get('set-cookie') ??
        '';
      assert.match(cookieLine, /HttpOnly/i);
      assert.equal(cookieLine.includes(srv.connectionToken), false);

      const sess = await fetch(new URL('v1/session', srv.url), {
        headers: { cookie: cookieLine.split(';')[0]! },
      });
      const sessBody = (await sess.json()) as { authenticated: boolean };
      assert.equal(sessBody.authenticated, true);
    } finally {
      await srv.close();
    }
  });
});
