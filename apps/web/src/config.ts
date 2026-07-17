/**
 * App configuration for the ZCode browser workspace.
 * Prefer same-origin `/git-proxy` so static hosts only need a Worker/function.
 *
 * Tokens: stored in sessionStorage only (not localStorage) unless user opts in.
 */

const STORAGE_KEY = 'zcode.web.config.v1';
const TOKEN_SESSION_KEY = 'zcode.web.gitToken';
const LEGACY_STANDALONE_PROXIES = new Set([
  'http://127.0.0.1:8787',
  'http://localhost:8787',
]);

export interface AppConfig {
  /** isomorphic-git corsProxy base URL (no trailing slash) */
  gitProxyUrl: string;
  /** Default / last-used clone URL */
  cloneUrl: string;
  treePageSize: number;
  authorName: string;
  authorEmail: string;
  /**
   * HTTPS PAT / password for private clone/push.
   * Loaded from sessionStorage; optional remember in localStorage under token key only if set.
   */
  gitToken?: string;
  gitUsername?: string;
}

export function sameOriginGitProxyUrl(origin = window.location.origin): string {
  return `${origin.replace(/\/+$/, '')}/git-proxy`;
}

export function defaultConfig(): AppConfig {
  return {
    gitProxyUrl: sameOriginGitProxyUrl(),
    cloneUrl: 'https://github.com/isomorphic-git/isomorphic-git.git',
    treePageSize: 200,
    authorName: 'ZCode',
    authorEmail: 'zcode@localhost',
  };
}

export const DEFAULT_CONFIG: AppConfig = {
  gitProxyUrl: '/git-proxy',
  cloneUrl: 'https://github.com/isomorphic-git/isomorphic-git.git',
  treePageSize: 200,
  authorName: 'ZCode',
  authorEmail: 'zcode@localhost',
};

export function loadConfig(): AppConfig {
  const defaults = defaultConfig();
  let stored: Partial<AppConfig> = {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) stored = JSON.parse(raw) as Partial<AppConfig>;
  } catch {
    /* ignore */
  }

  if (stored.gitProxyUrl && LEGACY_STANDALONE_PROXIES.has(normalizeProxyUrl(stored.gitProxyUrl))) {
    delete stored.gitProxyUrl;
  }
  // Never keep token in the main config blob if old versions stored it
  delete stored.gitToken;

  const params = new URLSearchParams(window.location.search);
  const fromQuery: Partial<AppConfig> = {};
  if (params.get('proxy')) fromQuery.gitProxyUrl = params.get('proxy')!;
  if (params.get('gitProxyUrl')) fromQuery.gitProxyUrl = params.get('gitProxyUrl')!;
  if (params.get('clone') || params.get('url')) {
    fromQuery.cloneUrl = (params.get('clone') || params.get('url'))!;
  }

  let gitToken: string | undefined;
  try {
    gitToken = sessionStorage.getItem(TOKEN_SESSION_KEY) ?? undefined;
  } catch {
    /* ignore */
  }

  return {
    ...defaults,
    ...stored,
    ...fromQuery,
    gitProxyUrl: normalizeProxyUrl(
      fromQuery.gitProxyUrl ?? stored.gitProxyUrl ?? defaults.gitProxyUrl,
    ),
    gitToken: gitToken || undefined,
    gitUsername: stored.gitUsername,
  };
}

export function saveConfig(cfg: AppConfig): void {
  const { gitToken, ...rest } = cfg;
  const toStore = {
    ...rest,
    gitProxyUrl: normalizeProxyUrl(cfg.gitProxyUrl),
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(toStore));
  try {
    if (gitToken?.trim()) {
      sessionStorage.setItem(TOKEN_SESSION_KEY, gitToken.trim());
    } else {
      sessionStorage.removeItem(TOKEN_SESSION_KEY);
    }
  } catch {
    /* ignore */
  }
}

export function normalizeProxyUrl(url: string): string {
  const t = url.trim();
  if (t.startsWith('/')) {
    return `${window.location.origin}${t}`.replace(/\/+$/, '');
  }
  return t.replace(/\/+$/, '');
}

export async function testGitProxy(
  proxyUrl: string,
  timeoutMs = 4000,
): Promise<{
  ok: boolean;
  status: number;
  latencyMs: number;
  body?: string;
}> {
  const base = normalizeProxyUrl(proxyUrl);
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  const started = performance.now();
  try {
    const res = await fetch(`${base}/healthz`, {
      method: 'GET',
      signal: controller.signal,
      mode: 'cors',
      credentials: 'same-origin',
    });
    const latencyMs = Math.round(performance.now() - started);
    const body = await res.text();
    return { ok: res.ok, status: res.status, latencyMs, body: body.slice(0, 200) };
  } finally {
    clearTimeout(t);
  }
}
