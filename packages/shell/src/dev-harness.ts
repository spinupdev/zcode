#!/usr/bin/env node
/**
 * Dev harness for shell bootstrap (Track B1).
 *
 * Serves a tiny static page that prints WorkbenchLoadConfig / capabilities.
 * This is NOT the VS Code workbench. Loading @vscode/test-web is opt-in via
 * ZCODE_ALLOW_TEST_WEB=1 and is never used in production builds.
 *
 * Usage:
 *   pnpm --filter @zcode/shell dev
 *   # open http://127.0.0.1:4173/?mode=browser
 *   # open http://127.0.0.1:4173/?authority=localhost:8080&ready=1
 */

import http from 'node:http';
import { URL } from 'node:url';
import {
  assertRemoteReady,
  bootstrapFromUrl,
  formatBootstrapSummary,
  isTestWebHarnessAllowed,
} from './bootstrap.js';

const HOST = process.env.ZCODE_SHELL_HOST ?? '127.0.0.1';
const PORT = Number(process.env.ZCODE_SHELL_PORT ?? 4173);

function htmlPage(body: string, status = 200): { status: number; body: string; type: string } {
  const page = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>ZCode shell harness (dev)</title>
  <style>
    body { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; margin: 2rem; background: #0d1117; color: #e6edf3; }
    h1 { font-size: 1.1rem; color: #58a6ff; }
    .warn { color: #d29922; margin: 1rem 0; padding: 0.75rem; border: 1px solid #d29922; border-radius: 6px; }
    pre { background: #161b22; padding: 1rem; border-radius: 6px; overflow: auto; }
    a { color: #58a6ff; }
    code { color: #a5d6ff; }
  </style>
</head>
<body>
  <h1>ZCode shell bootstrap harness</h1>
  <p class="warn">DEV ONLY — not a production workbench. Owned OSS web assets land in M0.
  <code>@vscode/test-web</code> is never shipped.</p>
  <p>Try:
    <a href="/?mode=browser&workspace=zcode-opfs://workspace/demo/">browser</a> ·
    <a href="/?authority=localhost:8080&ready=1">remote (ready)</a> ·
    <a href="/?authority=localhost:8080">remote (not ready)</a>
  </p>
  ${body}
</body>
</html>`;
  return { status, body: page, type: 'text/html; charset=utf-8' };
}

function handle(req: http.IncomingMessage, res: http.ServerResponse): void {
  const host = req.headers.host ?? `${HOST}:${PORT}`;
  const url = new URL(req.url ?? '/', `http://${host}`);

  if (url.pathname === '/api/bootstrap') {
    try {
      const result = bootstrapFromUrl(url);
      if (result.mode === 'remote' && result.workbench.resolvedConnection?.ready) {
        assertRemoteReady(result);
      }
      const payload = {
        ...result,
        summary: formatBootstrapSummary(result),
        harness: {
          testWebAllowed: isTestWebHarnessAllowed(),
          note: 'Production workbench load is out of scope for this harness',
        },
      };
      const body = JSON.stringify(payload, null, 2);
      res.writeHead(200, {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
      });
      res.end(body);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.writeHead(400, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: message }, null, 2));
    }
    return;
  }

  if (url.pathname !== '/' && url.pathname !== '/index.html') {
    res.writeHead(404).end('not found');
    return;
  }

  try {
    const result = bootstrapFromUrl(url);
    let remoteNote = '';
    try {
      if (result.mode === 'remote') {
        assertRemoteReady(result);
        remoteNote = '<p>Remote connection ready (cookie/login assumed).</p>';
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      remoteNote = `<p class="warn">Remote not ready: ${escapeHtml(message)}</p>`;
    }

    const body = `
      ${remoteNote}
      <h2>Summary</h2>
      <pre>${escapeHtml(formatBootstrapSummary(result))}</pre>
      <h2>WorkbenchLoadConfig</h2>
      <pre>${escapeHtml(JSON.stringify(result.workbench, null, 2))}</pre>
      <h2>Capabilities</h2>
      <pre>${escapeHtml(JSON.stringify(result.capabilities, null, 2))}</pre>
      <h2>Chrome</h2>
      <pre>${escapeHtml(JSON.stringify(result.chrome, null, 2))}</pre>
      <p>JSON: <a href="/api/bootstrap${url.search}"><code>/api/bootstrap</code></a></p>
    `;
    const page = htmlPage(body);
    res.writeHead(page.status, { 'content-type': page.type, 'cache-control': 'no-store' });
    res.end(page.body);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const page = htmlPage(`<pre class="warn">${escapeHtml(message)}</pre>`, 400);
    res.writeHead(page.status, { 'content-type': page.type });
    res.end(page.body);
  }
}

function escapeHtml(s: string): string {
  return s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

export function startDevHarness(port = PORT, host = HOST): http.Server {
  const server = http.createServer(handle);
  server.listen(port, host, () => {
    console.log(`ZCode shell harness (dev) http://${host}:${port}/`);
    console.log(`test-web allowed: ${isTestWebHarnessAllowed()}`);
  });
  return server;
}

const isMain =
  process.argv[1] &&
  (process.argv[1].endsWith('dev-harness.js') || process.argv[1].endsWith('dev-harness.ts'));

if (isMain) {
  startDevHarness();
}
