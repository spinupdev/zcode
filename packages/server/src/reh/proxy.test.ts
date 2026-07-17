import assert from 'node:assert/strict';
import http from 'node:http';
import { describe, it } from 'node:test';
import { CookieTokenBridge } from '../auth/cookie-bridge.js';
import { handleRehUpgrade, isReservedPath, tryProxyHttp } from './proxy.js';

describe('isReservedPath', () => {
  it('reserves shell routes', () => {
    assert.equal(isReservedPath('/'), true);
    assert.equal(isReservedPath('/login'), true);
    assert.equal(isReservedPath('/git-proxy/healthz'), true);
    assert.equal(isReservedPath('/debug/'), true);
    assert.equal(isReservedPath('/bootstrap.js'), true);
    assert.equal(isReservedPath('/vscode/out/vs/loader.js'), true);
    assert.equal(isReservedPath('/v1/session'), true);
  });

  it('allows REH-like paths', () => {
    assert.equal(isReservedPath('/version'), false);
    assert.equal(isReservedPath('/vscode-remote-resource'), false);
  });
});

describe('tryProxyHttp', () => {
  it('proxies authenticated requests and injects connectionToken upstream', async () => {
    const seen: { url?: string } = {};
    const reh = http.createServer((req, res) => {
      seen.url = req.url;
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end('reh-ok');
    });
    await new Promise<void>((r) => reh.listen(0, '127.0.0.1', () => r()));
    const rehPort = (reh.address() as { port: number }).port;

    const bridge = new CookieTokenBridge('proxy-test-secret');
    const session = bridge.createSession('tok-secret-xyz');
    const cookie = `zcode_sess=${session.cookieValue}`;

    const front = http.createServer((req, res) => {
      const handled = tryProxyHttp(req, res, {
        bridge,
        getTarget: () => ({
          endpoint: `http://127.0.0.1:${rehPort}`,
          connectionToken: 'tok-secret-xyz',
        }),
      });
      if (!handled) {
        res.writeHead(404).end('no');
      }
    });
    await new Promise<void>((r) => front.listen(0, '127.0.0.1', () => r()));
    const frontPort = (front.address() as { port: number }).port;

    try {
      const res = await fetch(`http://127.0.0.1:${frontPort}/version`, {
        headers: { cookie },
      });
      assert.equal(res.status, 200);
      assert.equal(await res.text(), 'reh-ok');
      // Default: no mandatory REH token — client tkn stripped, none re-injected
      assert.equal(seen.url?.includes('tok-secret-xyz'), false);
      assert.equal(cookie.includes('tok-secret-xyz'), false);
    } finally {
      await new Promise<void>((r) => front.close(() => r()));
      await new Promise<void>((r) => reh.close(() => r()));
    }
  });

  it('strips client-supplied tkn/connectionToken on upstream hop', async () => {
    const seen: { url?: string } = {};
    const reh = http.createServer((req, res) => {
      seen.url = req.url;
      res.writeHead(200).end('ok');
    });
    await new Promise<void>((r) => reh.listen(0, '127.0.0.1', () => r()));
    const rehPort = (reh.address() as { port: number }).port;
    const bridge = new CookieTokenBridge('proxy-test-secret-2');
    const session = bridge.createSession('server-token-real');
    const cookie = `zcode_sess=${session.cookieValue}`;
    const front = http.createServer((req, res) => {
      tryProxyHttp(req, res, {
        bridge,
        getTarget: () => ({
          endpoint: `http://127.0.0.1:${rehPort}`,
          connectionToken: 'server-token-real',
        }),
      });
    });
    await new Promise<void>((r) => front.listen(0, '127.0.0.1', () => r()));
    const frontPort = (front.address() as { port: number }).port;
    try {
      const res = await fetch(
        `http://127.0.0.1:${frontPort}/version?tkn=wrong-client-token&connectionToken=also-wrong`,
        { headers: { cookie } },
      );
      assert.equal(res.status, 200);
      assert.equal(seen.url?.includes('wrong-client-token'), false);
      assert.equal(seen.url?.includes('also-wrong'), false);
    } finally {
      await new Promise<void>((r) => front.close(() => r()));
      await new Promise<void>((r) => reh.close(() => r()));
    }
  });

  it('returns 401 for REH paths without cookie', async () => {
    const reh = http.createServer((_req, res) => res.end('x'));
    await new Promise<void>((r) => reh.listen(0, '127.0.0.1', () => r()));
    const rehPort = (reh.address() as { port: number }).port;
    const bridge = new CookieTokenBridge('s');
    const front = http.createServer((req, res) => {
      tryProxyHttp(req, res, {
        bridge,
        getTarget: () => ({
          endpoint: `http://127.0.0.1:${rehPort}`,
          connectionToken: 't',
        }),
      });
    });
    await new Promise<void>((r) => front.listen(0, '127.0.0.1', () => r()));
    const frontPort = (front.address() as { port: number }).port;
    try {
      const res = await fetch(`http://127.0.0.1:${frontPort}/version`);
      assert.equal(res.status, 401);
    } finally {
      await new Promise<void>((r) => front.close(() => r()));
      await new Promise<void>((r) => reh.close(() => r()));
    }
  });
});

describe('handleRehUpgrade', () => {
  it('rejects unauthenticated upgrades', async () => {
    const bridge = new CookieTokenBridge('s');
    const req = {
      url: '/',
      headers: { host: '127.0.0.1', cookie: '' },
    } as IncomingMessageLike;
    const chunks: Buffer[] = [];
    const socket = {
      write(data: string | Buffer) {
        chunks.push(Buffer.isBuffer(data) ? data : Buffer.from(data));
        return true;
      },
      destroy() {
        /* */
      },
      pipe() {
        return this;
      },
      on() {
        return this;
      },
    };
    const handled = handleRehUpgrade(req as never, socket as never, Buffer.alloc(0), {
      bridge,
      getTarget: () => ({ endpoint: 'http://127.0.0.1:9', connectionToken: 't' }),
    });
    assert.equal(handled, true);
    const text = Buffer.concat(chunks).toString('utf8');
    assert.match(text, /401/);
  });
});

type IncomingMessageLike = { url: string; headers: Record<string, string> };
