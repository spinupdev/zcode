import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { startServer } from './start.js';

describe('startServer login flow', () => {
  it('healthz and login set HttpOnly cookie without returning token', async () => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'zcode-serve-ws-'));
    const srv = await startServer({
      host: '127.0.0.1',
      port: 0,
      workspace,
      password: 'test-pass',
      spawnReh: false,
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

      const cookie = cookieLine.split(';')[0]!;
      const sess = await fetch(new URL('v1/session', srv.url), {
        headers: { cookie },
      });
      const sessBody = (await sess.json()) as {
        authenticated: boolean;
        workspaceImport?: boolean;
        executionOnly?: boolean;
        rehInfo?: { available?: boolean };
      };
      assert.equal(sessBody.authenticated, true);
      assert.equal(sessBody.workspaceImport, true);
      assert.ok(sessBody.rehInfo);

      // WS1 files-v1 import
      const imp = await fetch(new URL('v1/workspace/import', srv.url), {
        method: 'POST',
        headers: {
          cookie,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          format: 'files-v1',
          workspaceId: 'default',
          files: {
            'from-browser.py': { encoding: 'utf8', data: 'print(1)\n' },
          },
        }),
      });
      assert.equal(imp.status, 200);
      const impBody = (await imp.json()) as { ok: boolean; fileCount: number };
      assert.equal(impBody.ok, true);
      assert.equal(impBody.fileCount, 1);

      const exp = await fetch(new URL('v1/workspace/export', srv.url), {
        headers: { cookie },
      });
      assert.equal(exp.status, 200);
      const expBody = (await exp.json()) as {
        format: string;
        files: Record<string, { data: string }>;
      };
      assert.equal(expBody.format, 'files-v1');
      assert.ok(expBody.files['from-browser.py']);

      // RA3 execution-only
      assert.equal(sessBody.executionOnly, true);
      const execRes = await fetch(new URL('v1/exec', srv.url), {
        method: 'POST',
        headers: { cookie, 'content-type': 'application/json' },
        body: JSON.stringify({
          language: 'javascript',
          code: 'console.log("exec-ok");',
        }),
      });
      assert.equal(execRes.status, 200);
      const execBody = (await execRes.json()) as { exitCode: number; stdout: string };
      assert.equal(execBody.exitCode, 0);
      assert.match(execBody.stdout, /exec-ok/);
    } finally {
      await srv.close();
      fs.rmSync(workspace, { recursive: true, force: true });
    }
  });
});
