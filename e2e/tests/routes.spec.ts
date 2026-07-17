import { expect, test } from '@playwright/test';

test.describe('same-origin routes', () => {
  test('git-proxy healthz is ok', async ({ request }) => {
    const res = await request.get('/git-proxy/healthz');
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.service).toBe('zcode-git-proxy');
    expect(body.mode).toBe('stateless');
  });

  test('SPA index loads', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('button', { name: 'Clone' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Test proxy' })).toBeVisible();
  });

  test('IDE product.json dual-mode workspace id', async ({ request }) => {
    const res = await request.get('/ide/product.json?workspace=e2e-ws-1');
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.folderUri).toEqual({
      scheme: 'zcode-opfs',
      path: '/workspace/e2e-ws-1',
    });
    expect(body.additionalBuiltinExtensions?.length).toBeGreaterThan(0);
    const fsExt = body.additionalBuiltinExtensions.find(
      (e: { path: string }) => e.path === '/extensions/zcode-browser-fs',
    );
    expect(fsExt).toBeTruthy();
    expect(fsExt.authority).toMatch(/127\.0\.0\.1:\d+/);
  });

  test('IDE host page and vscode loader when staged', async ({ request }) => {
    const ide = await request.get('/ide/');
    expect(ide.ok()).toBeTruthy();
    const html = await ide.text();
    expect(html).toMatch(/bootstrap\.js|ZCode IDE/);

    const loader = await request.get('/vscode/out/vs/loader.js');
    // 200 if fetch-vscode-web was run; otherwise 404 — soft assert
    if (loader.status() === 200) {
      expect((await loader.body()).byteLength).toBeGreaterThan(1000);
    } else {
      test.info().annotations.push({
        type: 'note',
        description: 'dist/vscode-web not staged; skip loader size check',
      });
    }

    const ext = await request.get('/extensions/zcode-browser-fs/package.json');
    expect(ext.ok()).toBeTruthy();
    const pkg = await ext.json();
    expect(pkg.name).toBe('zcode-browser-fs');
    expect(pkg.browser).toMatch(/extension\.js/);
  });
});
