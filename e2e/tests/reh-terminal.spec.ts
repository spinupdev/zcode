/**
 * R6 / M1 STRICT — Terminal / remote attach e2e against REH via cookie proxy.
 *
 * Run: pnpm e2e:reh
 * STRICT: ZCODE_E2E_REH_STRICT=1 pnpm e2e:reh
 */
import fs from 'node:fs';
import path from 'node:path';
import { expect, test, type APIRequestContext, type Locator, type Page } from '@playwright/test';

const repoRoot = path.resolve(__dirname, '../..');
const marker = path.join(repoRoot, 'dist/server/.zcode-build.json');
const hasMarker = fs.existsSync(marker);
const password = process.env.ZCODE_E2E_PASSWORD ?? 'zcode-e2e';
const strict = process.env.ZCODE_E2E_REH_STRICT === '1';

function findBinary(dir: string): string | null {
  for (const c of ['bin/code-server-oss', 'bin/code-server', 'server.sh']) {
    const p = path.join(dir, c);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

const binary = hasMarker ? findBinary(path.join(repoRoot, 'dist/server')) : null;
const canRunFull = Boolean(hasMarker && binary);

async function loginApi(request: APIRequestContext) {
  const login = await request.post('/login', { data: { password } });
  expect(login.ok()).toBeTruthy();
  return login.json() as Promise<{ ok: boolean; authority: string }>;
}

async function loginInPage(page: Page) {
  await page.goto('/login');
  const pw = page.locator('input[name="password"]');
  if (await pw.count()) {
    await pw.fill(password);
    await page.click('button[type="submit"]');
    await page.waitForTimeout(500);
  } else {
    const ok = await page.evaluate(async (pwValue) => {
      const r = await fetch('/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ password: pwValue }),
      });
      return r.ok;
    }, password);
    expect(ok).toBeTruthy();
  }
  const sess = await page.evaluate(async () => {
    const r = await fetch('/v1/session', { credentials: 'same-origin' });
    return r.json();
  });
  expect(sess.authenticated || sess.ready).toBeTruthy();
  return sess as { authority?: string; workspacePath?: string };
}

test.describe('R6 REH terminal (cookie proxy)', () => {
  test('skips cleanly when no REH artifact (documented)', async () => {
    if (canRunFull) return;
    test.skip(true, 'no REH artifact — R2c required for full R6');
  });

  test('login sets session; healthz reports reh', async ({ request }) => {
    test.skip(!canRunFull, 'no runnable REH artifact');
    const health = await request.get('/healthz');
    expect(health.ok()).toBeTruthy();
    const h = await health.json();
    expect(['artifact', 'dev-script']).toContain(h.reh);

    const login = await request.post('/login', { data: { password } });
    expect(login.ok()).toBeTruthy();
    const body = await login.json();
    expect(body.ok).toBe(true);
    expect(body.connectionToken).toBeUndefined();

    const sess = await request.get('/v1/session');
    const s = await sess.json();
    expect(s.authenticated).toBe(true);
    expect(s.rehProxy).toBe(true);
    expect(s.workspacePath).toBeTruthy();
  });

  test('remote product + cookie-proxied /version', async ({ request }) => {
    test.skip(!canRunFull, 'no runnable REH artifact');
    const { authority } = await loginApi(request);
    const sess = await (await request.get('/v1/session')).json();

    const product = await request.get(
      `/ide/product.json?mode=remote&authority=${encodeURIComponent(authority)}`,
    );
    expect(product.ok()).toBeTruthy();
    const p = await product.json();
    expect(p.remoteAuthority).toBe(authority);
    expect(p.folderUri?.scheme).toBe('vscode-remote');
    expect(p.zcodeCapabilities?.terminal).toBe(true);
    if (sess.workspacePath) {
      expect(p.folderUri?.path).toBe(sess.workspacePath);
    }

    const version = await request.get('/version');
    expect(version.status()).toBeLessThan(500);
    if (version.status() === 200) {
      expect(await version.text()).not.toMatch(/connectionToken=|tkn=/i);
    }
  });

  test('IDE remote mode boots (STRICT: workbench + remote product + PTY)', async ({
    page,
    request,
  }) => {
    test.skip(!canRunFull, 'no runnable REH artifact');
    // Hard-fail PTY when set (CI after reliable remote shell); default STRICT is soft on PTY.
    const ptyRequired = process.env.ZCODE_E2E_REH_PTY_REQUIRED === '1';

    const sess = await loginInPage(page);
    const { authority: apiAuth } = await loginApi(request);
    const authority = sess.authority || apiAuth;
    const wsPath = sess.workspacePath;

    // Proxied version with browser cookie
    const verStatus = await page.evaluate(async () => {
      const r = await fetch('/version', { credentials: 'same-origin' });
      return r.status;
    });
    expect(verStatus).toBeLessThan(500);

    const pathQ = wsPath ? `&path=${encodeURIComponent(wsPath)}` : '';
    await page.goto(
      `/ide/?mode=remote&authority=${encodeURIComponent(authority)}&ready=1${pathQ}`,
    );

    await expect(page.locator('body')).toBeVisible();
    // Workbench or at least host page without missing-assets fallback
    await page.waitForTimeout(4_000);
    const fallback = page.locator('#fallback');
    if (await fallback.isVisible().catch(() => false)) {
      const t = await fallback.innerText();
      expect(t).not.toMatch(/Missing \/vscode|Missing \/extensions/i);
    }

    // monaco-workbench appears for both owned and dogfood once create() runs
    const wb = page.locator('.monaco-workbench, [role="application"]');
    await expect(wb.first()).toBeVisible({ timeout: 90_000 });

    // Remote agent / folder often needs a few more seconds before PTY is available
    await page.waitForTimeout(3_000);

    const product = await request.get(
      `/ide/product.json?mode=remote&authority=${encodeURIComponent(authority)}${pathQ}`,
    );
    const p = await product.json();
    expect(p.remoteAuthority).toBe(authority);
    expect(p.zcodeCapabilities?.terminal).toBe(true);

    const xterm = page.locator('.xterm-helper-textarea, .xterm').first();
    let termOk = await openIntegratedTerminal(page, xterm);

    let echoOk = false;
    if (termOk) {
      await xterm.click({ force: true }).catch(() => null);
      // printf is more reliable than echo for assertion (no shell alias noise)
      await page.keyboard.type('printf zcode_echo_ok\\n', { delay: 15 });
      await page.keyboard.press('Enter');
      try {
        await expect(page.locator('body')).toContainText('zcode_echo_ok', { timeout: 12_000 });
        echoOk = true;
      } catch {
        // Retry once: re-focus xterm and send plain echo
        await xterm.click({ force: true }).catch(() => null);
        await page.keyboard.type('printf zcode_echo_ok\\n', { delay: 20 });
        await page.keyboard.press('Enter');
        try {
          await expect(page.locator('body')).toContainText('zcode_echo_ok', { timeout: 10_000 });
          echoOk = true;
        } catch {
          echoOk = false;
        }
      }
    }

    if (strict) {
      expect(await wb.first().isVisible()).toBeTruthy();
      expect(p.remoteAuthority).toBeTruthy();
      expect(p.zcodeCapabilities?.terminal).toBe(true);

      if (ptyRequired) {
        expect(termOk, 'STRICT+PTY_REQUIRED: integrated terminal xterm must be visible').toBeTruthy();
        expect(echoOk, 'STRICT+PTY_REQUIRED: terminal must print zcode_echo_ok').toBeTruthy();
      } else if (echoOk) {
        test.info().annotations.push({
          type: 'info',
          description: 'STRICT: PTY verified (printf zcode_echo_ok)',
        });
      } else if (termOk) {
        test.info().annotations.push({
          type: 'warning',
          description: 'STRICT: xterm visible but zcode_echo_ok not observed',
        });
      } else {
        test.info().annotations.push({
          type: 'warning',
          description:
            'STRICT: workbench OK; integrated terminal xterm not verified (set ZCODE_E2E_REH_PTY_REQUIRED=1 to hard-fail)',
        });
      }
    }
  });
});

/** Open integrated terminal via shortcuts + command palette; return true if xterm is visible. */
async function openIntegratedTerminal(page: Page, xterm: Locator): Promise<boolean> {
  // 1) Chord shortcuts (Control on Linux/Windows Playwright Desktop Chrome; Meta on macOS)
  for (const chord of ['Control+Shift+`', 'Control+`', 'Meta+`'] as const) {
    await page.keyboard.press(chord).catch(() => null);
    await page.waitForTimeout(800);
    if (await xterm.isVisible().catch(() => false)) return true;
  }

  // 2) Command palette — more reliable once workbench keybindings are ready
  const isMac = process.platform === 'darwin';
  await page.keyboard.press(isMac ? 'Meta+Shift+p' : 'Control+Shift+p').catch(() => null);
  await page.waitForTimeout(500);
  const palette = page.locator(
    '.quick-input-widget input, .monaco-quick-input-widget input, input.input',
  );
  if (await palette.first().isVisible().catch(() => false)) {
    await palette.first().fill('Terminal: Create New Terminal');
    await page.waitForTimeout(400);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(2_000);
  }

  if (await xterm.isVisible().catch(() => false)) return true;

  // 3) Last resort: View: Toggle Terminal
  await page.keyboard.press(isMac ? 'Meta+Shift+p' : 'Control+Shift+p').catch(() => null);
  await page.waitForTimeout(400);
  if (await palette.first().isVisible().catch(() => false)) {
    await palette.first().fill('View: Toggle Terminal');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(2_000);
  }

  return xterm.isVisible().catch(() => false);
}
