/**
 * App configuration for the ZCode browser workspace.
 * Prefer same-origin `/git-proxy` so static hosts only need a Worker/function.
 */

const STORAGE_KEY = 'zcode.web.config.v1';
const LEGACY_STANDALONE_PROXIES = new Set([
  'http://127.0.0.1:8787',
  'http://localhost:8787',
]);

export interface AppConfig {
  /** isomorphic-git corsProxy base URL (no trailing slash), e.g. https://app/git-proxy */
  gitProxyUrl: string;
  /** Default / last-used clone URL */
  cloneUrl: string;
  /** Max file rows to render in the tree (perf) */
  treePageSize: number;
  /** Author for local commits */
  authorName: string;
  authorEmail: string;
}

/** Same-origin proxy mount — works with `zcode web`, `zcode serve`, CF Worker routes. */
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
  // Placeholder for types/docs; runtime uses defaultConfig() for origin-aware proxy.
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

  // Migrate old standalone-proxy default → same-origin
  if (stored.gitProxyUrl && LEGACY_STANDALONE_PROXIES.has(normalizeProxyUrl(stored.gitProxyUrl))) {
    delete stored.gitProxyUrl;
  }

  const params = new URLSearchParams(window.location.search);
  const fromQuery: Partial<AppConfig> = {};
  if (params.get('proxy')) fromQuery.gitProxyUrl = params.get('proxy')!;
  if (params.get('gitProxyUrl')) fromQuery.gitProxyUrl = params.get('gitProxyUrl')!;
  if (params.get('clone') || params.get('url')) {
    fromQuery.cloneUrl = (params.get('clone') || params.get('url'))!;
  }

  const merged = {
    ...defaults,
    ...stored,
    ...fromQuery,
  };

  return {
    ...merged,
    gitProxyUrl: normalizeProxyUrl(
      fromQuery.gitProxyUrl ?? stored.gitProxyUrl ?? defaults.gitProxyUrl,
    ),
  };
}

export function saveConfig(cfg: AppConfig): void {
  const toStore: AppConfig = {
    ...cfg,
    gitProxyUrl: normalizeProxyUrl(cfg.gitProxyUrl),
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(toStore));
}

export function normalizeProxyUrl(url: string): string {
  const t = url.trim();
  // Allow relative path for same-origin: "/git-proxy"
  if (t.startsWith('/')) {
    return `${window.location.origin}${t}`.replace(/\/+$/, '');
  }
  return t.replace(/\/+$/, '');
}

/** Probe git-proxy /healthz. Returns latency ms or throws. */
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
