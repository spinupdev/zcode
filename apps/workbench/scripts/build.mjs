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
    <p>Product IDE is <a href="/">/</a>. Optional git dogfood: <a href="/debug/">/debug/</a>.</p>
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
      const res = await fetch('/product.json' + location.search, { cache: 'no-store' });
      const ct = (res.headers.get('content-type') || '').toLowerCase();
      // Ignore SPA HTML fallbacks on static hosts
      if (res.ok && ct.includes('json')) window.product = await res.json();
    } catch (_) { /* embedded product */ }

    if (mode === 'remote' || window.product?.remoteAuthority || window.product?.zcodeMode === 'remote') {
      mode = 'remote';
      authority = authority || window.product?.remoteAuthority || location.host;
      // Cookie session only exists on zcode serve / Docker. Static hosts (Pages) have no /v1/session —
      // do not redirect to /login; fall back to browser mode when remote backend is absent.
      let hasSessionApi = false;
      try {
        const sess = await fetch('/v1/session', { cache: 'no-store', credentials: 'same-origin' });
        const ct = (sess.headers.get('content-type') || '').toLowerCase();
        if (sess.ok && ct.includes('json')) {
          hasSessionApi = true;
          const s = await sess.json();
          if (!s.authenticated && !s.ready) {
            const next = encodeURIComponent(location.pathname + location.search);
            location.replace('/login?redirect=' + next);
            return;
          }
          if (s.authority) authority = s.authority;
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
        /* static CDN: no session API */
      }
      if (!hasSessionApi && !params.get('authority') && !params.get('remoteAuthority')) {
        // Explicit remote without a backend → browser mode (production Pages)
        mode = 'browser';
      } else if (mode === 'remote') {
        const remotePath =
          params.get('path') ||
          window.product?.folderUri?.path ||
          '/home/workspace';
        window.product = {
          ...window.product,
          zcodeMode: 'remote',
          remoteAuthority: authority,
          connectionReady: hasSessionApi || params.get('ready') === '1',
          folderUri: {
            scheme: 'vscode-remote',
            authority: authority,
            path: remotePath,
          },
          windowIndicator: {
            label: '$(remote) ZCode remote',
            tooltip: 'Remote: ' + authority + (hasSessionApi ? ' (cookie-auth REH proxy)' : ' (static host)'),
          },
        };
      }
    }
    if (mode !== 'remote' && window.product) {
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

  // True asset probe: CDNs/SPA hosts often return 200 HTML for missing paths.
  // Never treat text/html as a successful JS/JSON asset (breaks production Pages).
  async function assetExists(url, kind) {
    try {
      // Prefer HEAD when Content-Type is honest
      let res = await fetch(url, { method: 'HEAD', cache: 'no-store' });
      if (res.ok) {
        const ct = (res.headers.get('content-type') || '').toLowerCase();
        if (!ct.includes('text/html')) {
          if (kind === 'js' && (ct.includes('javascript') || ct.includes('ecmascript'))) return true;
          if (kind === 'json' && ct.includes('json')) return true;
        } else {
          return false; // SPA fallback HTML
        }
      } else if (res.status === 404 || res.status === 405) {
        /* fall through to ranged GET */
      } else if (!res.ok) {
        return false;
      }
      // Ranged GET: small body, works when HEAD is missing/wrong
      res = await fetch(url, {
        method: 'GET',
        cache: 'no-store',
        headers: { Range: 'bytes=0-255', Accept: kind === 'json' ? 'application/json' : '*/*' },
      });
      if (!(res.ok || res.status === 206)) return false;
      const ct = (res.headers.get('content-type') || '').toLowerCase();
      if (ct.includes('text/html')) return false;
      const head = (await res.text()).trimStart();
      if (!head || head.startsWith('<!DOCTYPE') || head.startsWith('<html') || head.startsWith('<')) return false;
      if (kind === 'js') {
        return (
          ct.includes('javascript') ||
          ct.includes('ecmascript') ||
          ct.includes('octet-stream') ||
          ct === '' ||
          head.startsWith('"use strict"') ||
          head.startsWith("'use strict'") ||
          head.startsWith('import') ||
          head.startsWith('(') ||
          head.startsWith('var ') ||
          head.startsWith('const ') ||
          head.startsWith('function') ||
          head.startsWith('/*!')
        );
      }
      if (kind === 'json') {
        return head.startsWith('{') || head.startsWith('[') || ct.includes('json');
      }
      return true;
    } catch (_) {
      return false;
    }
  }

  // Detect layout: owned pin 1.129 esbuild (workbench.web.main.internal.js)
  // vs dogfood npm vscode-web (AMD loader.js).
  let layout = 'missing';
  try {
    if (await assetExists('/vscode/out/vs/workbench/workbench.web.main.internal.js', 'js')) {
      layout = 'owned-esbuild';
    } else if (await assetExists('/vscode/out/vs/loader.js', 'js')) {
      layout = 'dogfood-amd';
    }
    if (layout === 'missing') {
      showFallback(
        'Missing VS Code Web assets under /vscode/out — run ./scripts/fetch-vscode-web.sh or ./scripts/build-web.sh --package',
      );
      return;
    }
    if (!(await assetExists('/extensions/zcode-browser-fs/package.json', 'json'))) {
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
