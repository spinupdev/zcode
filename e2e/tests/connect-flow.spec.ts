/**
 * RA5 — connect prerequisites + remote product handoff (zcode serve).
 * Full VS Code UI "Connect" click is not automated; we verify the protocol path.
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

test.describe('remote connect flow (RA5)', () => {
  test('login → import → remote product → IDE page', async ({ request, page }) => {
    const cookie = await loginCookie(request);
    test.skip(!cookie, 'requires zcode serve (pnpm e2e:reh)');

    // Session ready for attach
    const sess = await request.get('/v1/session', { headers: { cookie: cookie! } });
    expect(sess.ok()).toBeTruthy();
    const s = await sess.json();
    expect(s.authenticated).toBe(true);
    expect(s.ready).toBe(true);
    expect(s.authority).toBeTruthy();
    expect(s.workspaceImport).toBe(true);
    expect(s.executionOnly).toBe(true);

    // Browser workspace material for Tier 1 attach
    const imp = await request.post('/v1/workspace/import', {
      headers: { cookie: cookie!, 'content-type': 'application/json' },
      data: {
        format: 'files-v1',
        workspaceId: 'ra5',
        files: {
          'ra5-connect.txt': { encoding: 'utf8', data: 'connected\n' },
        },
      },
    });
    expect(imp.ok()).toBeTruthy();

    // Product payload for remote mode (what workbench create() uses after reload)
    const authority = s.authority as string;
    const product = await request.get(
      `/product.json?mode=remote&authority=${encodeURIComponent(authority)}&ready=1`,
      { headers: { cookie: cookie! } },
    );
    expect(product.ok()).toBeTruthy();
    const p = await product.json();
    expect(p.remoteAuthority).toBe(authority);
    expect(p.zcodeMode).toBe('remote');
    expect(p.connectionReady).toBe(true);
    const raw = JSON.stringify(p);
    expect(raw).not.toMatch(/connectionToken|"tkn"/i);

    // Runtime extensions present (including execution-only remote)
    const paths = (p.additionalBuiltinExtensions ?? []).map((e: { path: string }) => e.path);
    expect(paths).toContain('/extensions/zcode-remote');
    expect(paths).toContain('/extensions/zcode-runtime-remote');
    expect(paths).toContain('/extensions/zcode-runtime-node');

    // IDE host loads clean remote URL (no secrets)
    const remoteUrl = `/?mode=remote&authority=${encodeURIComponent(authority)}&ready=1`;
    expect(remoteUrl).not.toMatch(/tkn=|connectCode=|password=/i);

    // Cookie must be sent by browser for REH proxy; set via context
    await page.context().addCookies([
      {
        name: 'zcode_sess',
        value: cookie!.replace(/^zcode_sess=/, ''),
        domain: '127.0.0.1',
        path: '/',
        httpOnly: true,
      },
    ]);

    const res = await page.goto(remoteUrl, { waitUntil: 'domcontentloaded' });
    expect(res?.ok()).toBeTruthy();
    // Workbench shell present (dogfood or owned)
    await expect(page.locator('body')).toBeVisible();
    // No secret leakage in location
    expect(page.url()).not.toMatch(/tkn=|connectionToken=|connectCode=/i);
  });

  test('extension packages for runtimes are served', async ({ request }) => {
    for (const name of [
      'zcode-runtime-core',
      'zcode-runtime-python',
      'zcode-runtime-node',
      'zcode-runtime-remote',
      'zcode-remote',
    ]) {
      const pkg = await request.get(`/extensions/${name}/package.json`);
      // On web-only e2e, extensions may be monorepo root; on serve, same
      if (pkg.status() === 404) {
        test.skip(true, `extension ${name} not mounted on this host`);
        return;
      }
      expect(pkg.ok()).toBeTruthy();
      const body = await pkg.json();
      expect(body.name).toBe(name);
    }
  });
});
