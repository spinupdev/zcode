export const DEFAULT_ALLOW_HOSTS = ['github.com', 'gitlab.com', 'bitbucket.org'] as const;

/** Default same-origin mount path (isomorphic-git corsProxy base). */
export const DEFAULT_GIT_PROXY_PREFIX = '/git-proxy';

export function isHostAllowed(hostname: string, allowHosts: readonly string[]): boolean {
  const host = hostname.toLowerCase();
  return allowHosts.some((allowed) => {
    const a = allowed.toLowerCase();
    return host === a || host.endsWith(`.${a}`);
  });
}

export function isBlockedHostname(host: string): boolean {
  const h = host.toLowerCase();
  if (h === 'localhost' || h.endsWith('.localhost')) return true;
  if (h === 'metadata.google.internal') return true;
  if (/^\d+\.\d+\.\d+\.\d+$/.test(h)) {
    const parts = h.split('.').map(Number);
    const [a, b] = parts;
    if (a === 10) return true;
    if (a === 127) return true;
    if (a === 0) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b! >= 16 && b! <= 31) return true;
    if (a === 192 && b === 168) return true;
  }
  return false;
}

/**
 * Map proxy request path to upstream HTTPS URL.
 * Path may be `/github.com/org/repo.git/...` or `github.com/org/repo.git/...`
 * (after optional mount-prefix strip).
 */
export function resolveUpstream(rawUrl: string, allowHosts: readonly string[]): URL {
  const u = new URL(rawUrl, 'http://git-proxy.local');
  let path = u.pathname;
  if (path.startsWith('/')) path = path.slice(1);
  if (!path) {
    throw Object.assign(new Error('missing upstream path'), { status: 400 });
  }
  if (path.includes('..')) {
    throw Object.assign(new Error('invalid path'), { status: 400 });
  }

  const hostEnd = path.indexOf('/');
  const hostname = hostEnd === -1 ? path : path.slice(0, hostEnd);
  const rest = hostEnd === -1 ? '' : path.slice(hostEnd);
  const hostOnly = hostname.split(':')[0]!;

  if (!isHostAllowed(hostOnly, allowHosts)) {
    throw Object.assign(new Error(`host not allowlisted: ${hostOnly}`), { status: 403 });
  }
  if (isBlockedHostname(hostOnly)) {
    throw Object.assign(new Error(`blocked host: ${hostOnly}`), { status: 403 });
  }

  return new URL(`https://${hostname}${rest}${u.search}`);
}

/** Strip mount prefix so remaining path is isomorphic-git style. */
export function stripProxyPrefix(urlPathAndQuery: string, prefix: string): string {
  const p = prefix.replace(/\/+$/, '') || '';
  if (!p || p === '/') return urlPathAndQuery;

  const qIndex = urlPathAndQuery.indexOf('?');
  const pathOnly = qIndex === -1 ? urlPathAndQuery : urlPathAndQuery.slice(0, qIndex);
  const query = qIndex === -1 ? '' : urlPathAndQuery.slice(qIndex);

  if (pathOnly === p || pathOnly === `${p}/`) {
    return `/${query}`; // health root
  }
  if (pathOnly.startsWith(`${p}/`)) {
    return pathOnly.slice(p.length) + query;
  }
  return urlPathAndQuery;
}

export function matchesProxyPrefix(pathname: string, prefix: string): boolean {
  const p = prefix.replace(/\/+$/, '') || '/git-proxy';
  return pathname === p || pathname.startsWith(`${p}/`);
}
