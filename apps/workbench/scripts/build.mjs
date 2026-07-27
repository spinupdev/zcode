/**
 * Build ZCode workbench loader (VS Code Web host page + product.json).
 * Static assets for VS Code itself live in dist/vscode-web (fetch-vscode-web.sh).
 */
import { mkdirSync, writeFileSync, readFileSync, cpSync, existsSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const monorepo = join(root, '../..');
const dist = join(root, 'dist');
mkdirSync(dist, { recursive: true });

const productOverlay = JSON.parse(
  readFileSync(join(monorepo, 'product/product.json'), 'utf8'),
);

// Zeish / ZCode brand favicon (from website) — replace VS Code favicon.ico
const brandIconSrc = join(monorepo, 'product/icon.svg');
if (existsSync(brandIconSrc)) {
  cpSync(brandIconSrc, join(dist, 'favicon.svg'));
  cpSync(brandIconSrc, join(dist, 'icon.svg'));
}

/** Built-in theme-defaults (always present under /vscode/extensions). */
const themeConfigurationDefaults = {
  'workbench.iconTheme': 'vs-seti',
  'workbench.colorTheme': 'Default Dark Modern',
  'workbench.preferredDarkColorTheme': 'Default Dark Modern',
  'workbench.preferredLightColorTheme': 'Default Light Modern',
  'workbench.preferredHighContrastColorTheme': 'Default High Contrast',
  'workbench.preferredHighContrastLightColorTheme': 'Default High Contrast Light',
  'window.autoDetectColorScheme': true,
  'vsicons.dontShowNewVersionMessage': true,
  'vsicons.dontShowConfigManuallyChangedMessage': true,
};

// TextMate language packs + themes from product/language-extensions.json
let languageExtensionIds = [];
try {
  const langManifest = JSON.parse(
    readFileSync(join(monorepo, 'product/language-extensions.json'), 'utf8'),
  );
  languageExtensionIds = Array.isArray(langManifest.extensions) ? langManifest.extensions : [];
} catch {
  console.warn('apps/workbench: product/language-extensions.json missing — syntax packs not listed');
}

const zcodeProductExtensions = [
  { path: '/extensions/zcode-browser-fs' },
  { path: '/extensions/zcode-git' },
  { path: '/extensions/zcode-diagnostics' },
  { path: '/extensions/zcode-runtime-core' },
  { path: '/extensions/zcode-runtime-python' },
  { path: '/extensions/zcode-runtime-node' },
  { path: '/extensions/zcode-runtime-remote' },
  { path: '/extensions/zcode-remote' },
  { path: '/extensions/vscode-icons' },
  { path: '/extensions/github-vscode-theme' },
];

const languageBuiltinExtensions = languageExtensionIds.map((id) => ({
  path: `/vscode/extensions/${id}`,
}));

const defaultProduct = {
  productConfiguration: {
    ...productOverlay,
    configurationDefaults: {
      'security.workspace.trust.enabled': false,
      'security.workspace.trust.startupPrompt': 'never',
      'workbench.startupEditor': 'welcomePage',
      ...themeConfigurationDefaults,
      'files.exclude': {
        '**/.git': true,
        '**/.git/**': true,
        '**/.zcode-workspace.json': true,
      },
    },
  },
  zcodeMode: 'browser',
  zcodeCapabilities: {
    terminal: false,
    browserGit: true,
    search: 'web-best-effort',
    executionBackends: ['browser-python', 'browser-node'],
    defaultExecutionBackend: 'browser-node',
  },
  // Open virtual workspace; shared IndexedDB with SPA (browser-agent IdbFs)
  folderUri: {
    scheme: 'zcode-opfs',
    path: '/workspace/default',
  },
  // Paths only — bootstrap.js injects scheme + authority from location
  additionalBuiltinExtensions: [...zcodeProductExtensions, ...languageBuiltinExtensions],
  homeIndicator: {
    href: '/',
    icon: 'code',
    title: 'ZCode Home',
  },
  windowIndicator: {
    label: '$(folder) ZCode browser',
    tooltip: 'Browser mode — virtual FS (zcode-opfs)',
  },
  // Bootstrap overwrites themeType from prefers-color-scheme before create()
  initialColorTheme: {
    themeType: 'dark',
  },
  // Top-level create() defaults (VS Code Web reads these in addition to productConfiguration)
  configurationDefaults: {
    ...themeConfigurationDefaults,
  },
  // Workspace is trusted so FS provider can write without prompts
  workspaceProvider: undefined, // filled by workbench.js from folderUri
};

console.log(
  `apps/workbench: ${languageBuiltinExtensions.length} language/theme packs + ${zcodeProductExtensions.length} product extensions`,
);

writeFileSync(join(dist, 'product.json'), JSON.stringify(defaultProduct, null, 2));

// Pre-workbench skeleton = VS Code monaco-parts-splash.
// Toast styles live outside initialShellColors so hideSplash() cannot unhide errors.
const indexHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
  <title>ZCode IDE</title>
  <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
  <link rel="apple-touch-icon" href="/icon.svg" />
  <!-- Stylesheet href is finalized by bootstrap.js (dogfood AMD vs owned esbuild). -->
  <link id="zcode-workbench-css" data-name="vs/workbench/workbench.web.main" rel="stylesheet" href="/vscode/out/vs/workbench/workbench.web.main.css" />
  <style class="initialShellColors">
    /* Splash colors approximate GitHub Dark/Light Default until the theme extension loads */
    html, body {
      width: 100%; height: 100%; margin: 0; padding: 0; overflow: hidden;
      background-color: #0d1117; color: #e6edf3;
    }
    /* VS Code parts splash (vendor/vscode .../workbench/workbench.ts #monaco-parts-splash) */
    #monaco-parts-splash {
      position: fixed; inset: 0; z-index: 100;
      background-color: #0d1117; color: #e6edf3;
      pointer-events: none; user-select: none;
    }
    #monaco-parts-splash.hidden { display: none !important; }
    #monaco-parts-splash .part { position: absolute; box-sizing: border-box; }
    #monaco-parts-splash .titlebar {
      top: 0; left: 0; right: 0; height: 35px;
      background: #0d1117;
      border-bottom: 1px solid #30363d;
    }
    #monaco-parts-splash .activitybar {
      top: 35px; left: 0; bottom: 22px; width: 48px;
      background: #0d1117;
      border-right: 1px solid #30363d;
    }
    #monaco-parts-splash .sidebar {
      top: 35px; left: 48px; bottom: 22px; width: min(300px, 28vw);
      background: #010409;
      border-right: 1px solid #30363d;
    }
    #monaco-parts-splash .sidebar-lines {
      position: absolute; top: 48px; left: 16px; right: 16px;
      display: flex; flex-direction: column; gap: 10px;
    }
    #monaco-parts-splash .sidebar-lines i {
      display: block; height: 8px; border-radius: 4px;
      background: rgba(230,237,243,0.08);
    }
    #monaco-parts-splash .sidebar-lines i:nth-child(1) { width: 55%; }
    #monaco-parts-splash .sidebar-lines i:nth-child(2) { width: 78%; }
    #monaco-parts-splash .sidebar-lines i:nth-child(3) { width: 42%; }
    #monaco-parts-splash .sidebar-lines i:nth-child(4) { width: 66%; }
    #monaco-parts-splash .sidebar-lines i:nth-child(5) { width: 50%; }
    #monaco-parts-splash .editor {
      top: 35px; left: calc(48px + min(300px, 28vw)); right: 0; bottom: 22px;
      background: #0d1117;
    }
    #monaco-parts-splash .tabs {
      position: absolute; top: 0; left: 0; right: 0; height: 35px;
      background: #010409;
      border-bottom: 1px solid #30363d;
    }
    #monaco-parts-splash .tab {
      position: absolute; top: 0; left: 0; width: 120px; height: 35px;
      background: #0d1117;
      border-right: 1px solid #30363d;
    }
    #monaco-parts-splash .statusbar {
      left: 0; right: 0; bottom: 0; height: 22px;
      background: #0d1117;
      border-top: 1px solid #30363d;
    }
    @media (prefers-color-scheme: light) {
      html, body {
        background-color: #ffffff; color: #1f2328;
      }
      #monaco-parts-splash {
        background-color: #ffffff; color: #1f2328;
      }
      #monaco-parts-splash .titlebar {
        background: #ffffff;
        border-bottom-color: #d0d7de;
      }
      #monaco-parts-splash .activitybar {
        background: #ffffff;
        border-right-color: #d0d7de;
      }
      #monaco-parts-splash .sidebar {
        background: #f6f8fa;
        border-right-color: #d0d7de;
      }
      #monaco-parts-splash .sidebar-lines i {
        background: rgba(31,35,40,0.08);
      }
      #monaco-parts-splash .editor { background: #ffffff; }
      #monaco-parts-splash .tabs {
        background: #f6f8fa;
        border-bottom-color: #d0d7de;
      }
      #monaco-parts-splash .tab {
        background: #ffffff;
        border-right-color: #d0d7de;
      }
      #monaco-parts-splash .statusbar {
        background: #ffffff;
        border-top-color: #d0d7de;
      }
    }
  </style>
  <!-- Permanent: never removed by hideSplash (avoids error toast leaking into IDE) -->
  <style id="zcode-toast-styles">
    #zcode-toast {
      display: none;
      position: fixed;
      z-index: 10000;
      right: 16px;
      bottom: 28px;
      max-width: min(420px, calc(100vw - 32px));
      font-family: system-ui, -apple-system, Segoe UI, sans-serif;
      font-size: 13px;
      line-height: 1.45;
      color: #f3f3f3;
      background: #252526;
      border: 1px solid #be1100;
      border-left: 4px solid #f14c4c;
      border-radius: 6px;
      box-shadow: 0 8px 24px rgba(0,0,0,0.45);
      padding: 12px 14px 12px 14px;
      box-sizing: border-box;
    }
    #zcode-toast.visible { display: block; }
    #zcode-toast .zcode-toast-title {
      font-weight: 600;
      margin: 0 28px 6px 0;
      color: #f14c4c;
    }
    #zcode-toast .zcode-toast-body { margin: 0; color: #cccccc; word-break: break-word; }
    #zcode-toast .zcode-toast-body a { color: #3794ff; }
    #zcode-toast .zcode-toast-close {
      position: absolute;
      top: 8px;
      right: 8px;
      border: 0;
      background: transparent;
      color: #cccccc;
      font-size: 18px;
      line-height: 1;
      cursor: pointer;
      padding: 2px 6px;
      border-radius: 4px;
    }
    #zcode-toast .zcode-toast-close:hover { background: rgba(255,255,255,0.08); color: #fff; }
  </style>
</head>
<body>
  <!-- Early shell skeleton. Hidden when workbench paints. -->
  <div id="monaco-parts-splash" class="vs-dark" aria-hidden="true">
    <div class="part titlebar"></div>
    <div class="part activitybar"></div>
    <div class="part sidebar">
      <div class="sidebar-lines" aria-hidden="true">
        <i></i><i></i><i></i><i></i><i></i>
      </div>
    </div>
    <div class="part editor">
      <div class="tabs"><div class="tab"></div></div>
    </div>
    <div class="part statusbar"></div>
  </div>
  <!-- Error toast only (not a full-page banner) -->
  <div id="zcode-toast" role="alert" aria-live="assertive" hidden>
    <button type="button" class="zcode-toast-close" aria-label="Dismiss">×</button>
    <p class="zcode-toast-title">ZCode IDE</p>
    <p class="zcode-toast-body" id="zcode-toast-body"></p>
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
  const splash = document.getElementById('monaco-parts-splash');
  const toast = document.getElementById('zcode-toast');
  const toastBody = document.getElementById('zcode-toast-body');
  const toastClose = toast && toast.querySelector('.zcode-toast-close');
  if (toastClose) {
    toastClose.addEventListener('click', () => hideToast());
  }
  function hideSplash() {
    if (splash) {
      splash.classList.add('hidden');
      splash.setAttribute('aria-hidden', 'true');
    }
    // Only remove splash shell colors — toast CSS is permanent (#zcode-toast-styles)
    document.head.querySelectorAll('style.initialShellColors').forEach((el) => el.remove());
  }
  function hideToast() {
    if (!toast) return;
    toast.classList.remove('visible');
    toast.hidden = true;
  }
  function showToast(msg) {
    hideSplash();
    if (!toast) return;
    const text =
      msg ||
      'VS Code Web could not start. Stage assets (fetch-vscode-web / workbench build) or redeploy.';
    if (toastBody) toastBody.textContent = text;
    toast.hidden = false;
    toast.classList.add('visible');
  }
  // Back-compat name used below
  function showFallback(msg) {
    showToast(msg);
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
      // Prefer URL ?workspace= · else last project (localStorage) · else default
      let lastWs = '';
      try {
        lastWs = (localStorage.getItem('zcode.lastWorkspaceId') || '').trim();
      } catch (_) { /* private mode */ }
      const ws = params.get('workspace') || lastWs || 'default';
      // Keep last-opened id sticky so Cmd-Shift-T / reopen restores the same project
      try {
        if (ws && ws !== 'default') localStorage.setItem('zcode.lastWorkspaceId', ws);
      } catch (_) { /* ignore */ }
      // Ask browser not to evict OPFS/IDB under storage pressure
      try {
        if (navigator.storage && navigator.storage.persist) {
          navigator.storage.persist().catch(function () {});
        }
      } catch (_) { /* ignore */ }
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
          tooltip: 'zcode-opfs workspace ' + ws + ' (OPFS/IDB; multi-project via Browser Projects)',
        },
      };
    }
  } catch (_) { /* ignore */ }

  window.product = withHostAuthority(window.product || {});
  // Match OS/browser light·dark before create() (GitHub Theme prefers + autoDetect).
  const prefersDark =
    typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches;
  const prefersLight =
    typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: light)').matches;
  // Prefer explicit light; otherwise dark (including no-preference).
  const themeType = prefersLight && !prefersDark ? 'light' : 'dark';
  window.product.initialColorTheme = { themeType };
  if (splash) {
    splash.classList.toggle('vs', themeType === 'light');
    splash.classList.toggle('vs-dark', themeType === 'dark');
  }
  // Ensure theme defaults survive if product.json is a partial overlay
  const themeDefaults = {
    'workbench.iconTheme': 'vscode-icons',
    'workbench.colorTheme': themeType === 'light' ? 'GitHub Light Default' : 'GitHub Dark Default',
    'workbench.preferredDarkColorTheme': 'GitHub Dark Default',
    'workbench.preferredLightColorTheme': 'GitHub Light Default',
    'workbench.preferredHighContrastColorTheme': 'GitHub Dark High Contrast',
    'workbench.preferredHighContrastLightColorTheme': 'GitHub Light High Contrast',
    'window.autoDetectColorScheme': true,
    'vsicons.dontShowNewVersionMessage': true,
    'vsicons.dontShowConfigManuallyChangedMessage': true,
  };
  window.product.configurationDefaults = {
    ...themeDefaults,
    ...(window.product.configurationDefaults || {}),
  };
  if (window.product.productConfiguration) {
    window.product.productConfiguration.configurationDefaults = {
      ...themeDefaults,
      ...(window.product.productConfiguration.configurationDefaults || {}),
    };
  }

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

  // Keep splash visible while scripts load; hide once workbench DOM appears or create() returns.
  function watchWorkbenchPaint() {
    const start = Date.now();
    const tick = () => {
      if (document.querySelector('.monaco-workbench')) {
        hideSplash();
        return;
      }
      if (Date.now() - start > 120_000) return;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }
  watchWorkbenchPaint();

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
    // create() has returned; workbench may paint next frames
    setTimeout(hideSplash, 0);
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
  setTimeout(hideSplash, 0);
  hideToast();
})().catch((err) => {
  console.error(err);
  // showToast is scoped inside the IIFE — duplicate minimal toast path here
  const splashEl = document.getElementById('monaco-parts-splash');
  if (splashEl) splashEl.classList.add('hidden');
  document.head.querySelectorAll('style.initialShellColors').forEach((el) => el.remove());
  const t = document.getElementById('zcode-toast');
  const b = document.getElementById('zcode-toast-body');
  if (b) b.textContent = String(err && err.message ? err.message : err);
  if (t) {
    t.hidden = false;
    t.classList.add('visible');
  }
});
`;

writeFileSync(join(dist, 'bootstrap.js'), bootstrap);

// Copy extension packages into workbench dist (optional offline host).
// Product server usually serves monorepo /extensions/* directly.
const extRoot = join(monorepo, 'extensions');
const extOut = join(dist, 'extensions');
const productExts = [
  'zcode-browser-fs',
  'zcode-git',
  'zcode-diagnostics',
  'zcode-runtime-core',
  'zcode-runtime-python',
  'zcode-runtime-node',
  'zcode-runtime-remote',
  'zcode-remote',
];
// Theme/icon contributions need full trees (icons/*.svg, themes/*.json).
const themeExts = ['vscode-icons', 'github-vscode-theme'];

for (const name of productExts) {
  const src = join(extRoot, name);
  const dest = join(extOut, name);
  if (!existsSync(join(src, 'package.json'))) continue;
  // Selective: package.json + dist only (skip node_modules)
  mkdirSync(join(dest, 'dist/web'), { recursive: true });
  cpSync(join(src, 'package.json'), join(dest, 'package.json'));
  const extJs = join(src, 'dist/web/extension.js');
  if (existsSync(extJs)) {
    cpSync(extJs, join(dest, 'dist/web/extension.js'));
  }
}

for (const name of themeExts) {
  const src = join(extRoot, name);
  const dest = join(extOut, name);
  if (!existsSync(join(src, 'package.json'))) {
    console.warn(
      `apps/workbench: missing ${name} — run pnpm fetch:themes for default icons/theme`,
    );
    continue;
  }
  // Force-replace so re-runs do not hit EEXIST on nested dirs
  if (existsSync(dest)) {
    rmSync(dest, { recursive: true, force: true });
  }
  cpSync(src, dest, { recursive: true });
}

console.log('apps/workbench: wrote dist/ (index, bootstrap, product, extensions)');
