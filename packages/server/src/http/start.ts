import http from 'node:http';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { CookieTokenBridge } from '../auth/cookie-bridge.js';
import { createPasswordVerifier, LoginRateLimiter } from '../auth/password.js';
import type { ServerOptions } from '../index.js';
import { monorepoRoot } from '../paths.js';
import { spawnReh, type RehHandle } from '../reh/spawn.js';
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

  const staticDir = resolveStaticDir(options.staticDir);
  const root = options.repoRoot ?? monorepoRoot();

  let reh: RehHandle | undefined;
  const rehPort = options.rehPort ?? options.port + 1;
  if (options.spawnReh !== false) {
    reh = spawnReh({
      connectionToken,
      rehPort,
      workspace: path.resolve(options.workspace),
      root,
    });
    if (reh.mode === 'none') {
      reh = undefined;
    }
  }

  const handler = createRequestHandler({
    bridge,
    passwords,
    limiter: new LoginRateLimiter(),
    connectionToken,
    authority: `${displayHost}:${options.port}`,
    secureCookies: process.env.ZCODE_SECURE_COOKIES === '1',
    staticDir,
    rehEndpoint: reh?.endpoint,
    rehMode: reh?.mode ?? 'none',
  });

  const server = http.createServer((req, res) => {
    void handler(req, res);
  });

  await new Promise<void>((resolve, reject) => {
    server.listen(options.port, options.host, () => resolve());
    server.on('error', reject);
  });

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
