import http from 'node:http';
import { randomBytes } from 'node:crypto';
import { CookieTokenBridge } from '../auth/cookie-bridge.js';
import { createPasswordVerifier, LoginRateLimiter } from '../auth/password.js';
import type { ServerOptions } from '../index.js';
import { createRequestHandler } from './app.js';

export interface StartedServer {
  url: string;
  authority: string;
  connectionToken: string;
  close(): Promise<void>;
}

/**
 * Start the product HTTP wrapper (login + session cookie + health).
 * Does not yet spawn VS Code REH — that wires in once dist/server exists.
 */
export async function startServer(options: ServerOptions): Promise<StartedServer> {
  const connectionToken = randomBytes(24).toString('base64url');
  const signingSecret =
    process.env.ZCODE_SESSION_SECRET ?? randomBytes(32).toString('base64url');
  const bridge = new CookieTokenBridge(signingSecret);
  const passwords = createPasswordVerifier(
    options.password ?? process.env.ZCODE_PASSWORD ?? 'zcode',
  );
  const authority = `${options.host === '0.0.0.0' ? '127.0.0.1' : options.host}:${options.port}`;

  const handler = createRequestHandler({
    bridge,
    passwords,
    limiter: new LoginRateLimiter(),
    connectionToken,
    authority,
    secureCookies: process.env.ZCODE_SECURE_COOKIES === '1',
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
  const host = options.host === '0.0.0.0' ? '127.0.0.1' : options.host;
  const url = `http://${host}:${port}/`;

  return {
    url,
    authority: `${host}:${port}`,
    connectionToken,
    close: () =>
      new Promise((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}
