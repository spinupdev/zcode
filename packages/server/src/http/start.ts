import http from 'node:http';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { CookieTokenBridge } from '../auth/cookie-bridge.js';
import { createPasswordVerifier, LoginRateLimiter } from '../auth/password.js';
import type { ServerOptions } from '../index.js';
import { isSpaDebugEnabled, spaDebugStatus } from '../spa-debug.js';
import { monorepoRoot } from '../paths.js';
import { handleRehUpgrade } from '../reh/proxy.js';
import { spawnReh, type RehHandle } from '../reh/spawn.js';
import { waitForUrl } from '../reh/wait.js';
import { createRequestHandler } from './app.js';

export interface StartedServer {
  url: string;
  authority: string;
  connectionToken: string;
  rehMode: string;
  close(): Promise<void>;
}

export async function startServer(options: ServerOptions): Promise<StartedServer> {
  const connectionToken = randomBytes(24).toString('base64url');
  const signingSecret =
    process.env.ZCODE_SESSION_SECRET ?? randomBytes(32).toString('base64url');
  const bridge = new CookieTokenBridge(signingSecret);
  const passwords = createPasswordVerifier(
    options.password ?? process.env.ZCODE_PASSWORD ?? 'zcode',
  );
  const displayHost = options.host === '0.0.0.0' ? '127.0.0.1' : options.host;

  const spaDebug =
    options.spaDebug !== undefined ? options.spaDebug : isSpaDebugEnabled();
  // SPA at `/debug/` is debug dogfood only — never auto-mount in production.
  const staticDir = spaDebug ? resolveStaticDir(options.staticDir) : undefined;
  if (!spaDebug && options.staticDir) {
    console.warn(
      `[zcode] SPA debug UI disabled (${spaDebugStatus().reason}); not serving ${options.staticDir}`,
    );
  } else if (spaDebug && staticDir) {
    console.log(`[zcode] SPA debug UI enabled at /debug/ (${spaDebugStatus().reason})`);
  }

  const root = options.repoRoot ?? monorepoRoot();
  const vscodeWebDir = resolveDir(path.join(root, 'dist/vscode-web'), 'out/vs');
  const workbenchDir = resolveDir(path.join(root, 'apps/workbench/dist'), 'index.html');
  const extensionsDir = resolveDir(path.join(root, 'extensions'));
  let productOverlay: Record<string, unknown> | undefined;
  try {
    const p = path.join(root, 'product/product.json');
    if (fs.existsSync(p)) productOverlay = JSON.parse(fs.readFileSync(p, 'utf8')) as Record<string, unknown>;
  } catch {
    /* ignore */
  }

  let reh: RehHandle | undefined;
  const rehPort = options.rehPort ?? options.port + 1;
  // Only spawn REH when explicitly requested or when a packaged artifact exists.
  // Avoid kicking vendor/vscode dev scripts (node version / multi-hour installs) by default.
  const shouldSpawnReh =
    options.spawnReh === true ||
    process.env.ZCODE_SPAWN_REH === '1' ||
    (options.spawnReh !== false && fs.existsSync(path.join(root, 'dist/server/.zcode-build.json')));
  if (shouldSpawnReh) {
    reh = spawnReh({
      connectionToken,
      rehPort,
      workspace: path.resolve(options.workspace), // must match product folderUri.path
      root,
    });
    if (reh.mode === 'none') {
      reh = undefined;
    }
  }

  const workspaceAbs = path.resolve(options.workspace);
  const handler = createRequestHandler({
    bridge,
    passwords,
    limiter: new LoginRateLimiter(),
    connectionToken,
    authority: `${displayHost}:${options.port}`,
    secureCookies: process.env.ZCODE_SECURE_COOKIES === '1',
    staticDir,
    vscodeWebDir,
    workbenchDir,
    extensionsDir,
    productOverlay,
    rehEndpoint: reh?.endpoint,
    rehMode: reh?.mode ?? 'none',
    rehProxyEnabled: Boolean(reh?.endpoint),
    gitProxy: options.gitProxy !== false,
    workspacePath: workspaceAbs,
  });

  const server = http.createServer((req, res) => {
    void handler(req, res);
  });

  // R3b: WebSocket upgrades → REH with cookie → connection-token injection
  server.on('upgrade', (req, socket, head) => {
    const handled = handleRehUpgrade(req, socket, head, {
      bridge,
      getTarget: () =>
        reh?.endpoint
          ? { endpoint: reh.endpoint, connectionToken }
          : null,
    });
    if (!handled) {
      socket.write('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n');
      socket.destroy();
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.listen(options.port, options.host, () => resolve());
    server.on('error', reject);
  });

  // Wait for REH *after* listen so /healthz is up for Playwright webServer probes.
  if (reh?.endpoint) {
    const waitMs = Number(process.env.ZCODE_REH_READY_MS ?? 45_000);
    try {
      await waitForUrl(`${reh.endpoint}/version`, {
        timeoutMs: waitMs,
        intervalMs: 400,
        okStatuses: [200, 204],
      });
    } catch (err) {
      console.warn(
        `[zcode] REH not ready within ${waitMs}ms:`,
        err instanceof Error ? err.message : err,
      );
    }
  }

  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : options.port;
  const url = `http://${displayHost}:${port}/`;

  return {
    url,
    authority: `${displayHost}:${port}`,
    connectionToken,
    rehMode: reh?.mode ?? 'none',
    close: async () => {
      await reh?.stop();
      await new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
    },
  };
}

function resolveStaticDir(explicit?: string): string | undefined {
  if (explicit) {
    return fs.existsSync(explicit) ? path.resolve(explicit) : undefined;
  }
  const candidates = [
    path.join(monorepoRoot(), 'apps/web/dist'),
    path.join(process.cwd(), 'apps/web/dist'),
    path.join(process.cwd(), 'dist/web'),
  ];
  for (const c of candidates) {
    if (fs.existsSync(path.join(c, 'index.html'))) return c;
  }
  return undefined;
}

function resolveDir(dir: string, mustContain?: string): string | undefined {
  if (!fs.existsSync(dir)) return undefined;
  if (mustContain && !fs.existsSync(path.join(dir, mustContain))) return undefined;
  return dir;
}
