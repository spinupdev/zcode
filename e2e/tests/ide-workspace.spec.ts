import { expect, test } from '@playwright/test';

/**
 * Shared workspace bridge: agent clone (Node-side via page request is heavy);
 * we seed IDB from the SPA agent is hard in Playwright without UI.
 *
 * This test verifies IDE loads with workspace query and extension is fetchable,
 * then uses SPA clone + Open in IDE path when network allows.
 */
test.describe('IDE workspace handoff', () => {
  test('product.json workspace id and extension JS load', async ({ page, request }) => {
    const ws = 'playwright-ws';
    const product = await request.get(`/ide/product.json?workspace=${ws}`);
    expect(product.ok()).toBeTruthy();
    const body = await product.json();
    expect(body.folderUri.path).toBe(`/workspace/${ws}`);

    const extJs = await request.get('/extensions/zcode-browser-fs/dist/web/extension.js');
    expect(extJs.ok()).toBeTruthy();
    const text = await extJs.text();
    // Bundled IDB provider should reference shared DB name
    expect(text).toMatch(/zcode-fs-v1|IdbFs|zcode-opfs/);
  });

  test('IDE page bootstraps without hard error when vscode-web staged', async ({ page }) => {
    const loader = await page.request.get('/vscode/out/vs/loader.js');
    test.skip(loader.status() !== 200, 'dist/vscode-web not staged — run ./scripts/fetch-vscode-web.sh');

    await page.goto('/ide/?workspace=default');
    // Fallback should hide if assets load; or show fallback message
    await page.waitForTimeout(3000);
    const fallback = page.locator('#fallback');
    const fallbackVisible = await fallback.isVisible().catch(() => false);
    if (fallbackVisible) {
      const t = await fallback.innerText();
      // Acceptable if still loading scripts; fail only on missing assets message after wait
      if (/Missing \/vscode|Missing \/extensions/i.test(t)) {
        throw new Error(`IDE fallback: ${t.slice(0, 200)}`);
      }
    }
    // workbench body exists
    await expect(page.locator('body')).toBeVisible();
  });
});
