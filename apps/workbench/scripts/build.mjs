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
    },
  },
  // Open virtual workspace; zcode-browser-fs registers this scheme
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
  <link data-name="vs/workbench/workbench.web.main" rel="stylesheet" href="/vscode/out/vs/workbench/workbench.web.main.css" />
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
    <p>Then open <a href="/ide/">/ide/</a>. Lightweight git SPA: <a href="/">/</a>.</p>
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

  // Dual-mode from query
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
    } else if (window.product) {
      const ws = params.get('workspace') || 'default';
      window.product = {
        ...window.product,
        folderUri: {
          scheme: 'zcode-opfs',
          path: '/workspace/' + ws,
        },
      };
    }
    try {
      const res = await fetch('/ide/product.json' + location.search, { cache: 'no-store' });
      if (res.ok) window.product = await res.json();
    } catch (_) { /* embedded product */ }
  } catch (_) { /* ignore */ }

  window.product = withHostAuthority(window.product || {});

  try {
    const probe = await fetch('/vscode/out/vs/loader.js', { method: 'HEAD', cache: 'no-store' });
    if (!probe.ok) {
      showFallback('Missing /vscode/out/vs/loader.js — run ./scripts/fetch-vscode-web.sh');
      return;
    }
    // Probe extension package
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

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.onload = resolve;
      s.onerror = () => reject(new Error('Failed to load ' + src));
      document.body.appendChild(s);
    });
  }

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
