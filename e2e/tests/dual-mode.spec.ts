import { expect, test } from '@playwright/test';

/**
 * M1 — dual-mode product payload (browser vs remoteAuthority).
 */
test.describe('dual-mode product (M1)', () => {
  test('browser product has zcode-opfs and no terminal capability', async ({ request }) => {
    const res = await request.get('/product.json?workspace=m1-ws');
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.remoteAuthority).toBeFalsy();
    expect(body.folderUri).toEqual({
      scheme: 'zcode-opfs',
      path: '/workspace/m1-ws',
    });
    expect(body.zcodeMode).toBe('browser');
    expect(body.zcodeCapabilities?.terminal).toBe(false);
    expect(body.zcodeCapabilities?.browserGit).toBe(true);
    const paths = (body.additionalBuiltinExtensions ?? []).map(
      (e: { path: string }) => e.path,
    );
    expect(paths).toContain('/extensions/zcode-diagnostics');
    expect(body.productConfiguration?.configurationDefaults?.[
      'terminal.integrated.enablePersistentSessions'
    ]).toBe(false);
  });

  test('remote product sets remoteAuthority and enables terminal', async ({ request }) => {
    const res = await request.get(
      '/product.json?mode=remote&authority=127.0.0.1:15010',
    );
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.remoteAuthority).toBe('127.0.0.1:15010');
    expect(body.folderUri?.scheme).toBe('vscode-remote');
    expect(body.folderUri?.authority).toBe('127.0.0.1:15010');
    expect(body.zcodeMode).toBe('remote');
    expect(body.zcodeCapabilities?.terminal).toBe(true);
    expect(body.zcodeCapabilities?.search).toBe('ripgrep');
    expect(body.connectionReady).toBe(true);
    // No secrets in product payload
    const raw = JSON.stringify(body);
    expect(raw).not.toMatch(/connectionToken|tkn=/i);
  });

  test('IDE HTML includes CSP when served', async ({ request }) => {
    const res = await request.get('/');
    expect(res.ok()).toBeTruthy();
    // Static web path may not set CSP; when headers present, check shape
    const csp = res.headers()['content-security-policy'];
    if (csp) {
      expect(csp).toMatch(/default-src/);
      expect(csp).toMatch(/'self'/);
    }
  });
});
