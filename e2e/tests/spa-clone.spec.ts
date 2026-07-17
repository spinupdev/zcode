import { expect, test } from '@playwright/test';

/**
 * UI clone via isomorphic-git + same-origin /git-proxy.
 * Uses a tiny public repo for speed.
 */
test.describe('SPA clone flow', () => {
  test('test proxy then clone Hello-World', async ({ page }) => {
    test.setTimeout(180_000);

    await page.goto('/debug/');

    // Wait for app.js to apply default same-origin proxy into the form
    const proxyInput = page.locator('#proxy-url');
    await expect(proxyInput).toBeVisible();
    await expect(proxyInput).toHaveValue(/git-proxy/, { timeout: 15_000 });

    await page.getByRole('button', { name: 'Test proxy' }).click();
    await expect(page.locator('#proxy-status')).toContainText(/proxy ok/i, {
      timeout: 15_000,
    });

    await page.locator('#clone-url').fill('https://github.com/octocat/Hello-World.git');
    // Auto-confirm "Open in IDE?" dialog after clone
    page.once('dialog', (d) => d.dismiss());

    await page.getByRole('button', { name: 'Clone', exact: true }).click();

    // Progress or log should show activity
    await expect
      .poll(async () => page.locator('#log').innerText(), { timeout: 120_000 })
      .toMatch(/clon(e|ing)|ready on branch|CLONE|progress|receiving|done/i);

    // Wait for success log
    await expect
      .poll(async () => page.locator('#log').innerText(), { timeout: 120_000 })
      .toMatch(/cloned |ready on branch/i);

    // File tree should list at least one entry (README etc.)
    await expect
      .poll(async () => page.locator('#tree button.file').count(), { timeout: 30_000 })
      .toBeGreaterThan(0);

    const meta = await page.locator('#tree-meta').innerText();
    expect(meta).toMatch(/\d+\s+files/i);
  });
});
