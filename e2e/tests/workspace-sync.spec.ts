/**
 * WS1 — workspace import/export API (requires zcode serve + password).
 * Skipped when not running under playwright.reh.config (no /login).
 */
import { expect, test } from '@playwright/test';

const password = process.env.ZCODE_E2E_PASSWORD ?? 'zcode-e2e';

async function loginCookie(request: import('@playwright/test').APIRequestContext): Promise<string | null> {
  const login = await request.post('/login', {
    data: { password },
    failOnStatusCode: false,
  });
  if (!login.ok()) return null;
  const setCookie = login.headers()['set-cookie'] ?? '';
  const match = /zcode_sess=[^;]+/.exec(setCookie);
  return match?.[0] ?? null;
}

test.describe('workspace sync files-v1 (WS1)', () => {
  test('import then export round-trip when serve auth is available', async ({ request }) => {
    const cookie = await loginCookie(request);
    test.skip(!cookie, 'zcode serve login not available (use pnpm e2e:reh)');

    const sess = await request.get('/v1/session', {
      headers: { cookie: cookie! },
    });
    expect(sess.ok()).toBeTruthy();
    const s = await sess.json();
    expect(s.authenticated).toBe(true);
    expect(s.workspaceImport).toBe(true);
    expect(s.rehInfo).toBeTruthy();

    const rel = `e2e-sync-${Date.now()}.txt`;
    const imp = await request.post('/v1/workspace/import', {
      headers: {
        cookie: cookie!,
        'content-type': 'application/json',
      },
      data: {
        format: 'files-v1',
        workspaceId: 'e2e',
        files: {
          [rel]: { encoding: 'utf8', data: 'hello-from-e2e\n' },
        },
      },
    });
    expect(imp.ok()).toBeTruthy();
    const impBody = await imp.json();
    expect(impBody.ok).toBe(true);
    expect(impBody.fileCount).toBeGreaterThanOrEqual(1);

    const exp = await request.get('/v1/workspace/export', {
      headers: { cookie: cookie! },
    });
    expect(exp.ok()).toBeTruthy();
    const expBody = await exp.json();
    expect(expBody.format).toBe('files-v1');
    expect(expBody.files[rel]?.data).toContain('hello-from-e2e');

    // RA3 execution-only (no remoteAuthority)
    expect(s.executionOnly).toBe(true);
    const exec = await request.post('/v1/exec', {
      headers: {
        cookie: cookie!,
        'content-type': 'application/json',
      },
      data: {
        language: 'javascript',
        code: 'console.log("ra5-exec-ok");',
      },
    });
    expect(exec.ok()).toBeTruthy();
    const execBody = await exec.json();
    expect(execBody.exitCode).toBe(0);
    expect(execBody.stdout).toContain('ra5-exec-ok');
  });

  test('import rejects unauthenticated requests when login exists', async ({ request }) => {
    const probe = await request.post('/login', {
      data: { password: 'definitely-wrong' },
      failOnStatusCode: false,
    });
    // If server has no /login (static web e2e), skip
    if (probe.status() === 404) {
      test.skip(true, 'static web host — no auth surface');
      return;
    }

    const imp = await request.post('/v1/workspace/import', {
      data: {
        format: 'files-v1',
        files: { 'x.txt': { encoding: 'utf8', data: 'x' } },
      },
      failOnStatusCode: false,
    });
    // serve returns 401; static web may 404
    expect([401, 404]).toContain(imp.status());
  });
});

