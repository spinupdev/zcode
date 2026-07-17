import http from 'node:http';
import { DEFAULT_ALLOW_HOSTS, type GitProxyOptions } from './index.js';
import { createGitProxyHandler } from './handler.js';

export interface StartedGitProxy {
  url: string;
  close(): Promise<void>;
}

/**
 * Standalone git-proxy server (root mount).
 * For product hosting prefer mounting under `/git-proxy` on the same origin as the SPA.
 */
export async function startGitProxy(options: GitProxyOptions): Promise<StartedGitProxy> {
  const allowHosts = options.allowHosts.length
    ? options.allowHosts
    : [...DEFAULT_ALLOW_HOSTS];

  const handle = createGitProxyHandler({
    prefix: '',
    allowHosts,
  });

  const server = http.createServer((req, res) => {
    void handle(req, res);
  });

  await new Promise<void>((resolve, reject) => {
    server.listen(options.port, options.host, () => resolve());
    server.on('error', reject);
  });

  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : options.port;
  const host = options.host === '0.0.0.0' ? '127.0.0.1' : options.host;

  return {
    url: `http://${host}:${port}`,
    close: () =>
      new Promise((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}

export { resolveUpstream } from './allowlist.js';
