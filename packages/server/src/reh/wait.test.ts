import assert from 'node:assert/strict';
import http from 'node:http';
import { describe, it } from 'node:test';
import { waitForUrl } from './wait.js';

describe('waitForUrl', () => {
  it('resolves when endpoint becomes ready', async () => {
    let hits = 0;
    const server = http.createServer((_req, res) => {
      hits += 1;
      if (hits < 3) {
        res.writeHead(503).end('booting');
        return;
      }
      res.writeHead(200).end('ok');
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
    const port = (server.address() as { port: number }).port;
    try {
      const result = await waitForUrl(`http://127.0.0.1:${port}/ready`, {
        timeoutMs: 5_000,
        intervalMs: 20,
        okStatuses: [200],
      });
      assert.equal(result.status, 200);
      assert.equal(result.body, 'ok');
      assert.ok(hits >= 3);
    } finally {
      await new Promise<void>((r) => server.close(() => r()));
    }
  });

  it('times out when never ready', async () => {
    const server = http.createServer((_req, res) => {
      res.writeHead(503).end('no');
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
    const port = (server.address() as { port: number }).port;
    try {
      await assert.rejects(
        () =>
          waitForUrl(`http://127.0.0.1:${port}/x`, {
            timeoutMs: 200,
            intervalMs: 40,
          }),
        /timeout/,
      );
    } finally {
      await new Promise<void>((r) => server.close(() => r()));
    }
  });
});
