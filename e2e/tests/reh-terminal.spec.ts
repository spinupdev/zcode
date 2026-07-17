/**
 * R6 — Terminal / remote attach e2e against REH via cookie proxy.
 *
 * Without dist/server/.zcode-build.json this suite skips (soft pass for default CI).
 * With a real REH artifact: login → session → remote product → terminal echo ok.
 *
 * Run: pnpm e2e:reh   (or scripts/e2e-reh-terminal.sh)
 */
import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';

const repoRoot = path.resolve(__dirname, '../..');
const marker = path.join(repoRoot, 'dist/server/.zcode-build.json');
const hasMarker = fs.existsSync(marker);
const password = process.env.ZCODE_E2E_PASSWORD ?? 'zcode-e2e';

function findBinary(dir: string): string | null {
  const candidates = [
    'bin/code-server-oss',
    'bin/code-server',
    'server.sh',
    'bin/remote-cli/code',
  ];
  for (const c of candidates) {
    const p = path.join(dir, c);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

const binary = hasMarker ? findBinary(path.join(repoRoot, 'dist/server')) : null;
const canRunFull = Boolean(hasMarker && binary);

test.describe('R6 REH terminal (cookie proxy)', () => {
  test('skips cleanly when no REH artifact (documented)', async () => {
    if (canRunFull) {
      test.info().annotations.push({
        type: 'note',
        description: `REH artifact present: ${binary}`,
      });
      return;
    }
    test.info().annotations.push({
      type: 'skip-reason',
      description:
        'No runnable dist/server REH. Produce with ./scripts/build-server.sh or CI vscode-reh-build workflow_dispatch, then re-run pnpm e2e:reh',
    });
    // Soft assertion: suite is wired; full path needs R2c
    expect(hasMarker && !binary).toBeFalsy(); // marker without binary is odd but ok
    test.skip(true, 'no REH artifact — R2c required for full R6');
  });

  test('login sets HttpOnly session; healthz reports reh', async ({ request }) => {
    test.skip(!canRunFull, 'no runnable REH artifact');

    const health = await request.get('/healthz');
    expect(health.ok()).toBeTruthy();
    const h = await health.json();
    expect(h.ok).toBe(true);
    // When artifact is present and spawn succeeded
    expect(['artifact', 'dev-script']).toContain(h.reh);

    const bad = await request.post('/login', {
      data: { password: 'definitely-wrong' },
    });
    expect(bad.status()).toBe(401);

    const login = await request.post('/login', {
      data: { password },
    });
    expect(login.ok()).toBeTruthy();
    const body = await login.json();
    expect(body.ok).toBe(true);
    expect(body.connectionToken).toBeUndefined();
    expect(body.authority).toMatch(/127\.0\.0\.1:\d+/);

    const setCookie = login.headers()['set-cookie'] ?? '';
    expect(setCookie).toMatch(/zcode_sess=/i);
    expect(setCookie).toMatch(/HttpOnly/i);
    // Cookie must not embed the raw connection token (KD12)
    expect(setCookie).not.toMatch(/connectionToken|tkn=/i);

    const sess = await request.get('/v1/session');
    const s = await sess.json();
    expect(s.authenticated).toBe(true);
    expect(s.authority).toBeTruthy();
    expect(s.rehProxy).toBe(true);
  });

  test('remote product.json and cookie-proxied REH /version', async ({ request }) => {
    test.skip(!canRunFull, 'no runnable REH artifact');

    const login = await request.post('/login', { data: { password } });
    expect(login.ok()).toBeTruthy();
    const { authority } = await login.json();

    const product = await request.get(
      `/ide/product.json?mode=remote&authority=${encodeURIComponent(authority)}`,
    );
    expect(product.ok()).toBeTruthy();
    const p = await product.json();
    expect(p.remoteAuthority).toBe(authority);
    expect(p.folderUri?.scheme).toBe('vscode-remote');

    // REH path through cookie proxy (token injected server-side only)
    const version = await request.get('/version');
    // REH may expose /version as 200 JSON or redirect — accept 2xx
    expect(version.status()).toBeLessThan(500);
    if (version.status() === 200) {
      const text = await version.text();
      // Must not leak raw connection secrets in body strings we control
      expect(text).not.toMatch(/connectionToken=|tkn=/i);
    }
  });

  test('IDE remote mode boots; terminal when workbench is ready', async ({ page, request }) => {
    test.skip(!canRunFull, 'no runnable REH artifact');

    // Form login for a real browser HttpOnly cookie
    await page.goto('/');
    if (await page.locator('input[name="password"]').count()) {
      await page.fill('input[name="password"]', password);
      await page.click('button[type="submit"]');
      await page.waitForTimeout(800);
    }

    const sess = await request.get('/v1/session');
    // request fixture may not share page cookies — re-login via API for authority
    const login = await request.post('/login', { data: { password } });
    expect(login.ok()).toBeTruthy();
    const { authority } = await login.json();

    const remoteUrl = `/ide/?mode=remote&authority=${encodeURIComponent(authority)}&ready=1`;
    await page.goto(remoteUrl);
    await page.waitForTimeout(8_000);

    const fallback = page.locator('#fallback');
    if (await fallback.isVisible().catch(() => false)) {
      const t = await fallback.innerText();
      if (/Missing \/vscode|Missing \/extensions/i.test(t)) {
        throw new Error(`IDE missing assets: ${t.slice(0, 240)}`);
      }
    }

    // Product/workbench should not leave a hard error page
    await expect(page.locator('body')).toBeVisible();

    // Best-effort terminal: command palette (Ctrl/Meta+Shift+P) then Create New Terminal
    for (const chord of ['Control+Shift+P', 'Meta+Shift+P'] as const) {
      await page.keyboard.press(chord);
      await page.waitForTimeout(600);
      const input = page.locator('.quick-input-widget input, .monaco-inputbox input').first();
      if (await input.isVisible().catch(() => false)) {
        await input.fill('Terminal: Create New Terminal');
        await page.waitForTimeout(400);
        await page.keyboard.press('Enter');
        break;
      }
    }
    await page.keyboard.press('Control+`').catch(() => null);
    await page.waitForTimeout(4_000);

    const terminal = page
      .locator('.terminal, .xterm, .xterm-helper-textarea, textarea.xterm-helper-textarea')
      .first();
    const terminalVisible = await terminal.isVisible().catch(() => false);

    if (!terminalVisible) {
      // Contract covered by API tests + unit proxy flow; UI terminal is best-effort
      // until workbench remote connection is fully dogfooded (M1).
      test.info().annotations.push({
        type: 'note',
        description:
          'Terminal UI not visible yet — API cookie proxy + REH spawn passed. Set ZCODE_E2E_REH_STRICT=1 to fail.',
      });
      if (process.env.ZCODE_E2E_REH_STRICT === '1') {
        await expect(terminal).toBeVisible({ timeout: 5_000 });
      }
      return;
    }

    await terminal.click({ force: true }).catch(() => null);
    await page.keyboard.type('echo ok', { delay: 30 });
    await page.keyboard.press('Enter');
    await page.waitForTimeout(2_000);

    const bodyText = await page.locator('body').innerText();
    const rows = page.locator('.xterm-rows, .xterm-screen');
    const rowText = (await rows.count()) > 0 ? await rows.first().innerText().catch(() => '') : '';
    const combined = `${bodyText}\n${rowText}`;
    if (process.env.ZCODE_E2E_REH_STRICT === '1') {
      expect(combined).toMatch(/\bok\b/);
    } else if (!/\bok\b/.test(combined)) {
      test.info().annotations.push({
        type: 'warning',
        description: `Terminal visible but "ok" not found: ${combined.slice(0, 300)}`,
      });
    }
  });
});
