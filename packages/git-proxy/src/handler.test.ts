import assert from 'node:assert/strict';
import http from 'node:http';
import { describe, it } from 'node:test';
import { createGitProxyHandler } from './handler.js';

describe('createGitProxyHandler mount', () => {
  it('serves healthz under /git-proxy and ignores other paths', async () => {
    const handle = createGitProxyHandler({ prefix: '/git-proxy' });
    const server = http.createServer((req, res) => {
      void (async () => {
        const handled = await handle(req, res);
        if (!handled) {
          res.writeHead(404).end('nope');
        }
      })();
    });
    await new Promise<void>((resolve, reject) => {
      server.listen(0, '127.0.0.1', () => resolve());
      server.on('error', reject);
    });
    const addr = server.address();
    const port = typeof addr === 'object' && addr ? addr.port : 0;
    const base = `http://127.0.0.1:${port}`;

    try {
      const h = await fetch(`${base}/git-proxy/healthz`);
      assert.equal(h.status, 200);
      const body = (await h.json()) as { ok: boolean; service: string };
      assert.equal(body.ok, true);
      assert.equal(body.service, 'zcode-git-proxy');

      const miss = await fetch(`${base}/other`);
      assert.equal(miss.status, 404);
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
    }
  });
});
