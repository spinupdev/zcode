/**
 * Build ZCode workbench loader (VS Code Web host page + product.json).
 * Static assets for VS Code itself live in dist/vscode-web (fetch-vscode-web.sh).
 */
import { mkdirSync, writeFileSync, readFileSync, cpSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const monorepo = join(root, '../..');
const dist = join(root, 'dist');
mkdirSync(dist, { recursive: true });

const productOverlay = JSON.parse(
  readFileSync(join(monorepo, 'product/product.json'), 'utf8'),
);

// Default create() payload (browser mode). Runtime may rewrite via /ide/product.json API.
const defaultProduct = {
  productConfiguration: productOverlay,
  folderUri: {
    scheme: 'zcode-opfs',
    path: '/workspace/default',
  },
  additionalBuiltinExtensions: [
    { scheme: 'http', path: '/extensions/zcode-browser-fs' },
    { scheme: 'http', path: '/extensions/zcode-git' },
    { scheme: 'http', path: '/extensions/zcode-diagnostics' },
  ],
  homeIndicator: {
    href: '/',
    icon: 'code',
    title: 'ZCode',
  },
  windowIndicator: {
    label: '$(remote) ZCode browser',
    tooltip: 'Browser mode (no remoteAuthority)',
  },
};

writeFileSync(join(dist, 'product.json'), JSON.stringify(defaultProduct, null, 2));

const indexHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
  <title>ZCode IDE</title>
  <link rel="icon" href="/vscode/favicon.ico" type="image/x-icon" />
  <link data-name="vs/workbench/workbench.web.main" rel="stylesheet" href="/vscode/out/vs/workbench/workbench.web.main.css" />
  <style>
    html, body { width: 100%; height: 100%; margin: 0; padding: 0; overflow: hidden; }
    #fallback {
      font-family: system-ui, sans-serif; padding: 2rem; max-width: 40rem; margin: 0 auto;
      color: #e6edf3; background: #0d1117; min-height: 100%; box-sizing: border-box;
    }
    #fallback a { color: #58a6ff; }
    #fallback code { background: #21262d; padding: 0.1rem 0.35rem; border-radius: 4px; }
    #fallback.hidden { display: none; }
  </style>
</head>
<body>
  <div id="fallback">
    <h1>ZCode IDE (VS Code Web)</h1>
    <p>VS Code Web static assets are not staged yet.</p>
    <pre>./scripts/fetch-vscode-web.sh
# or own build: docs/building-vscode.md → gulp vscode-web</pre>
    <p>Then restart the server. Meanwhile use the <a href="/">browser workspace SPA</a>.</p>
  </div>
  <script>
    window.product = ${JSON.stringify(defaultProduct)};
  </script>
  <script type="module" src="./bootstrap.js"></script>
</body>
</html>
`;

writeFileSync(join(dist, 'index.html'), indexHtml);

// bootstrap.js — load AMD workbench if /vscode assets exist
const bootstrap = `
(async function () {
  const fallback = document.getElementById('fallback');
  function showFallback(msg) {
    if (fallback) {
      fallback.classList.remove('hidden');
      if (msg) {
        const p = document.createElement('p');
        p.textContent = msg;
        fallback.appendChild(p);
      }
    }
  }

  // Dual-mode from query: ?mode=remote&authority=host:port
  try {
    const params = new URLSearchParams(location.search);
    const mode = params.get('mode');
    const authority = params.get('authority') || params.get('remoteAuthority');
    if (mode === 'remote' && authority && window.product) {
      window.product = {
        ...window.product,
        remoteAuthority: authority,
        folderUri: {
          scheme: 'vscode-remote',
          authority,
          path: params.get('path') || '/home/workspace',
        },
        windowIndicator: {
          label: '$(remote) ZCode remote',
          tooltip: 'Remote: ' + authority,
        },
      };
    }
    // Prefer server-generated product when available
    try {
      const res = await fetch('/ide/product.json' + location.search, { cache: 'no-store' });
      if (res.ok) {
        window.product = await res.json();
      }
    } catch (_) { /* use embedded */ }
  } catch (_) { /* ignore */ }

  // Probe vscode assets
  try {
    const probe = await fetch('/vscode/out/vs/loader.js', { method: 'HEAD', cache: 'no-store' });
    if (!probe.ok) {
      showFallback('Missing /vscode/out/vs/loader.js — run ./scripts/fetch-vscode-web.sh');
      return;
    }
  } catch (e) {
    showFallback(String(e));
    return;
  }

  if (fallback) fallback.classList.add('hidden');

  const baseUrl = new URL('/vscode', location.origin).toString();

  await new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = '/vscode/out/vs/loader.js';
    s.onload = resolve;
    s.onerror = () => reject(new Error('loader.js failed'));
    document.head.appendChild(s);
  });
  await new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = '/vscode/out/vs/webPackagePaths.js';
    s.onload = resolve;
    s.onerror = () => reject(new Error('webPackagePaths.js failed'));
    document.head.appendChild(s);
  });

  Object.keys(self.webPackagePaths || {}).forEach(function (key) {
    self.webPackagePaths[key] = baseUrl + '/node_modules/' + key + '/' + self.webPackagePaths[key];
  });

  require.config({
    baseUrl: baseUrl + '/out',
    recordStats: true,
    trustedTypesPolicy: window.trustedTypes?.createPolicy('amdLoader', {
      createScriptURL(value) {
        if (value.startsWith(window.location.origin)) return value;
        throw new Error('Invalid script url: ' + value);
      }
    }),
    paths: self.webPackagePaths
  });

  await new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = '/vscode/out/vs/workbench/workbench.web.main.nls.js';
    s.onload = resolve;
    s.onerror = () => reject(new Error('nls failed'));
    document.body.appendChild(s);
  });
  await new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = '/vscode/out/vs/workbench/workbench.web.main.js';
    s.onload = resolve;
    s.onerror = () => reject(new Error('workbench.web.main failed'));
    document.body.appendChild(s);
  });
  await new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = '/vscode/out/vs/code/browser/workbench/workbench.js';
    s.onload = resolve;
    s.onerror = () => reject(new Error('workbench.js failed'));
    document.body.appendChild(s);
  });
})().catch((err) => {
  console.error(err);
  const fallback = document.getElementById('fallback');
  if (fallback) {
    fallback.classList.remove('hidden');
    const p = document.createElement('p');
    p.textContent = String(err);
    fallback.appendChild(p);
  }
});
`;

writeFileSync(join(dist, 'bootstrap.js'), bootstrap);

// Copy extension builds for additionalBuiltinExtensions
const extRoot = join(monorepo, 'extensions');
const extOut = join(dist, 'extensions');
for (const name of ['zcode-browser-fs', 'zcode-git', 'zcode-diagnostics']) {
  const src = join(extRoot, name);
  if (existsSync(src)) {
    cpSync(src, join(extOut, name), { recursive: true });
  }
}

console.log('apps/workbench: wrote dist/index.html, product.json, bootstrap.js');
