/**
 * HTTP CORS proxy for isomorphic-git (browser mode).
 * Required for GitHub/GitLab-class hosts. Not a control plane.
 */

export interface GitProxyOptions {
  host: string;
  port: number;
  /** Allowed upstream hostnames (SSRF allowlist) */
  allowHosts: string[];
}

export const DEFAULT_ALLOW_HOSTS = ['github.com', 'gitlab.com', 'bitbucket.org'] as const;

export function isHostAllowed(hostname: string, allowHosts: readonly string[]): boolean {
  const host = hostname.toLowerCase();
  return allowHosts.some((allowed) => {
    const a = allowed.toLowerCase();
    return host === a || host.endsWith(`.${a}`);
  });
}

export { startGitProxy, resolveUpstream } from './proxy.js';
export type { StartedGitProxy } from './proxy.js';
