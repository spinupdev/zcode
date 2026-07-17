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

const defaultProduct = {
  productConfiguration: {
    ...productOverlay,
    // Helpful web defaults
    configurationDefaults: {
      'security.workspace.trust.enabled': false,
      'security.workspace.trust.startupPrompt': 'never',
      'workbench.startupEditor': 'readme',
      'files.exclude': { '**/.git': true, '**/.git/**': true },
    },
  },
  // Open virtual workspace; shared IndexedDB with SPA (browser-agent IdbFs)
  folderUri: {
    scheme: 'zcode-opfs',
    path: '/workspace/default',
  },
  // Paths only — bootstrap.js injects scheme + authority from location
  additionalBuiltinExtensions: [
    { path: '/extensions/zcode-browser-fs' },
    { path: '/extensions/zcode-git' },
    { path: '/extensions/zcode-diagnostics' },
  ],
  homeIndicator: {
    href: '/',
    icon: 'code',
    title: 'ZCode Home',
  },
  windowIndicator: {
    label: '$(remote) ZCode browser',
    tooltip: 'Browser mode — virtual FS (zcode-opfs)',
  },
  // Workspace is trusted so FS provider can write without prompts
  workspaceProvider: undefined, // filled by workbench.js from folderUri
};

writeFileSync(join(dist, 'product.json'), JSON.stringify(defaultProduct, null, 2));

const indexHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
  <title>ZCode IDE</title>
  <link rel="icon" href="/vscode/favicon.ico" type="image/x-icon" />
  <!-- Stylesheet href is finalized by bootstrap.js (dogfood AMD vs owned esbuild). -->
  <link id="zcode-workbench-css" data-name="vs/workbench/workbench.web.main" rel="stylesheet" href="/vscode/out/vs/workbench/workbench.web.main.css" />
  <style>
    html, body { width: 100%; height: 100%; margin: 0; padding: 0; overflow: hidden; background: #1e1e1e; }
    #fallback {
      font-family: system-ui, sans-serif; padding: 2rem; max-width: 42rem; margin: 0 auto;
      color: #e6edf3; background: #0d1117; min-height: 100%; box-sizing: border-box;
    }
    #fallback a { color: #58a6ff; }
    #fallback code { background: #21262d; padding: 0.1rem 0.35rem; border-radius: 4px; }
    #fallback.hidden { display: none; }
    #fallback pre { background: #161b22; padding: 0.75rem; border-radius: 6px; overflow: auto; }
  </style>
</head>
<body>
  <div id="fallback">
    <h1>ZCode IDE (VS Code Web)</h1>
    <p>VS Code Web static assets are not staged yet.</p>
    <pre>./scripts/fetch-vscode-web.sh
pnpm --filter @zcode/workbench build
pnpm --filter zcode-browser-fs build
node apps/cli/dist/cli.js web --dir apps/web/dist --port 5000</pre>
    <p>Then open <a href="/">/</a> (product IDE). Debug SPA (DEV): <a href="/debug/">/debug/</a>.</p>
  </div>
  <script>
    window.product = ${JSON.stringify(defaultProduct)};
  </script>
  <script src="./bootstrap.js"></script>
</body>
</html>
`;

writeFileSync(join(dist, 'index.html'), indexHtml);

const bootstrap = `/* ZCode workbench bootstrap — load VS Code Web + inject extension URIs */
(async function () {
  const fallback = document.getElementById('fallback');
  function showFallback(msg) {
    if (!fallback) return;
    fallback.classList.remove('hidden');
    if (msg) {
      const p = document.createElement('p');
      p.textContent = msg;
      fallback.appendChild(p);
    }
  }

  function withHostAuthority(product) {
    const scheme = location.protocol === 'https:' ? 'https' : 'http';
    const authority = location.host;
    const next = { ...product };
    if (Array.isArray(next.additionalBuiltinExtensions)) {
      next.additionalBuiltinExtensions = next.additionalBuiltinExtensions.map((ext) => {
        const path = (ext.path || ext).toString().startsWith('/')
          ? (ext.path || ext)
          : '/' + (ext.path || ext);
        return { scheme, authority, path: typeof path === 'string' ? path : ext.path };
      });
    }
    return next;
  }

  // Dual-mode from query + product.json (M1)
  try {
    const params = new URLSearchParams(location.search);
    let mode = params.get('mode');
    let authority = params.get('authority') || params.get('remoteAuthority');
    // Prefer server-built dual-mode payload (capabilities, configurationDefaults)
    try {
      // Prefer /product.json; fall back to legacy /ide/product.json
      let res = await fetch('/product.json' + location.search, { cache: 'no-store' });
      if (!res.ok) {
        res = await fetch('/ide/product.json' + location.search, { cache: 'no-store' });
      }
      if (res.ok) window.product = await res.json();
    } catch (_) { /* embedded product */ }

    if (mode === 'remote' || window.product?.remoteAuthority || window.product?.zcodeMode === 'remote') {
      mode = 'remote';
      authority = authority || window.product?.remoteAuthority || location.host;
      // Same-origin cookie session required before remote connect (no token in URL)
      try {
        const sess = await fetch('/v1/session', { cache: 'no-store', credentials: 'same-origin' });
        if (sess.ok) {
          const s = await sess.json();
          if (!s.authenticated && !s.ready) {
            const next = encodeURIComponent(location.pathname + location.search);
            location.replace('/login?redirect=' + next);
            return;
          }
          if (s.authority) authority = s.authority;
          // Align folder path with REH workspace (absolute host path)
          if (s.workspacePath && !params.get('path')) {
            window.product = {
              ...window.product,
              folderUri: {
                scheme: 'vscode-remote',
                authority: authority,
                path: s.workspacePath,
              },
            };
          }
          window.product = {
            ...window.product,
            connectionReady: true,
            remoteAuthority: authority,
          };
        }
      } catch (_) {
        /* static web may not expose /v1/session — still allow dogfood */
      }
      const remotePath =
        params.get('path') ||
        window.product?.folderUri?.path ||
        '/home/workspace';
      window.product = {
        ...window.product,
        zcodeMode: 'remote',
        remoteAuthority: authority,
        folderUri: {
          scheme: 'vscode-remote',
          authority: authority,
          path: remotePath,
        },
        windowIndicator: {
          label: '$(remote) ZCode remote',
          tooltip: 'Remote: ' + authority + ' (cookie-auth REH proxy)',
        },
      };
    } else if (window.product) {
      const ws = params.get('workspace') || 'default';
      window.product = {
        ...window.product,
        zcodeMode: 'browser',
        remoteAuthority: undefined,
        folderUri: {
          scheme: 'zcode-opfs',
          path: '/workspace/' + ws,
        },
        windowIndicator: {
          label: '$(folder) ' + String(ws).slice(0, 12),
          tooltip: 'zcode-opfs workspace ' + ws + ' (shared IDB with SPA; no PTY)',
        },
      };
    }
  } catch (_) { /* ignore */ }

  window.product = withHostAuthority(window.product || {});

  function loadScript(src, type) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      if (type) s.type = type;
      s.onload = resolve;
      s.onerror = () => reject(new Error('Failed to load ' + src));
      document.body.appendChild(s);
    });
  }

  function setWorkbenchCss(href) {
    const link = document.getElementById('zcode-workbench-css');
    if (link) link.href = href;
  }

  // Detect layout: owned pin 1.129 esbuild (workbench.web.main.internal.js)
  // vs dogfood npm vscode-web (AMD loader.js).
  let layout = 'missing';
  try {
    const owned = await fetch('/vscode/out/vs/workbench/workbench.web.main.internal.js', {
      method: 'HEAD',
      cache: 'no-store',
    });
    if (owned.ok) {
      layout = 'owned-esbuild';
    } else {
      const dogfood = await fetch('/vscode/out/vs/loader.js', { method: 'HEAD', cache: 'no-store' });
      if (dogfood.ok) layout = 'dogfood-amd';
    }
    if (layout === 'missing') {
      showFallback(
        'Missing VS Code Web assets under /vscode/out — run ./scripts/fetch-vscode-web.sh or ./scripts/build-web.sh --package',
      );
      return;
    }
    const ext = await fetch('/extensions/zcode-browser-fs/package.json', { cache: 'no-store' });
    if (!ext.ok) {
      showFallback('Missing /extensions/zcode-browser-fs — rebuild extensions and workbench');
      return;
    }
  } catch (e) {
    showFallback(String(e));
    return;
  }

  if (fallback) fallback.classList.add('hidden');

  const baseUrl = new URL('/vscode', location.origin).toString();
  globalThis._VSCODE_FILE_ROOT = baseUrl + '/out/';

  if (layout === 'owned-esbuild') {
    // Owned microsoft/vscode @ pin — ESM esbuild bundle (vscode-web-ci).
    setWorkbenchCss('/vscode/out/vs/workbench/workbench.web.main.internal.css');
    try {
      await loadScript('/vscode/out/nls.messages.js');
    } catch (_) {
      /* english fallback is compiled into bundle */
    }
    const mod = await import('/vscode/out/vs/workbench/workbench.web.main.internal.js');
    if (typeof mod.create !== 'function') {
      throw new Error('owned workbench.web.main.internal.js missing create() export');
    }
    mod.create(document.body, window.product || {});
    return;
  }

  // Dogfood AMD (vscode-web npm package)
  setWorkbenchCss('/vscode/out/vs/workbench/workbench.web.main.css');
  await loadScript('/vscode/out/vs/loader.js');
  await loadScript('/vscode/out/vs/webPackagePaths.js');

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

  await loadScript('/vscode/out/vs/workbench/workbench.web.main.nls.js');
  await loadScript('/vscode/out/vs/workbench/workbench.web.main.js');
  await loadScript('/vscode/out/vs/code/browser/workbench/workbench.js');
})().catch((err) => {
  console.error(err);
  const fallback = document.getElementById('fallback');
  if (fallback) {
    fallback.classList.remove('hidden');
    const p = document.createElement('p');
    p.textContent = String(err && err.message ? err.message : err);
    fallback.appendChild(p);
  }
});
`;

writeFileSync(join(dist, 'bootstrap.js'), bootstrap);

// Copy extension packages (must include package.json + dist/web/extension.js)
const extRoot = join(monorepo, 'extensions');
const extOut = join(dist, 'extensions');
for (const name of ['zcode-browser-fs', 'zcode-git', 'zcode-diagnostics']) {
  const src = join(extRoot, name);
  if (existsSync(src)) {
    cpSync(src, join(extOut, name), { recursive: true });
  }
}

console.log('apps/workbench: wrote dist/ (index, bootstrap, product, extensions)');
