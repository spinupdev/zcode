/**
 * HTTP CORS proxy for isomorphic-git (browser mode).
 * Stateless: no session store. Prefer same-origin mount at `/git-proxy`.
 */

export interface GitProxyOptions {
  host: string;
  port: number;
  /** Allowed upstream hostnames (SSRF allowlist) */
  allowHosts: string[];
}

export {
  DEFAULT_ALLOW_HOSTS,
  DEFAULT_GIT_PROXY_PREFIX,
  isHostAllowed,
  isBlockedHostname,
  resolveUpstream,
  stripProxyPrefix,
  matchesProxyPrefix,
} from './allowlist.js';

export { createGitProxyHandler } from './handler.js';
export type { GitProxyHandlerOptions } from './handler.js';

export { startGitProxy } from './proxy.js';
export type { StartedGitProxy } from './proxy.js';
