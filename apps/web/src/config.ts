/**
 * App configuration for the ZCode browser workspace.
 * Proxy URL and defaults persist in localStorage; URL query can override.
 */

const STORAGE_KEY = 'zcode.web.config.v1';

export interface AppConfig {
  /** isomorphic-git corsProxy base URL (no trailing slash) */
  gitProxyUrl: string;
  /** Default / last-used clone URL */
  cloneUrl: string;
  /** Max file rows to render in the tree (perf) */
  treePageSize: number;
  /** Author for local commits */
  authorName: string;
  authorEmail: string;
}

export const DEFAULT_CONFIG: AppConfig = {
  gitProxyUrl: 'http://127.0.0.1:8787',
  cloneUrl: 'https://github.com/isomorphic-git/isomorphic-git.git',
  treePageSize: 200,
  authorName: 'ZCode',
  authorEmail: 'zcode@localhost',
};

export function loadConfig(): AppConfig {
  let stored: Partial<AppConfig> = {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) stored = JSON.parse(raw) as Partial<AppConfig>;
  } catch {
    /* ignore */
  }

  const params = new URLSearchParams(window.location.search);
  const fromQuery: Partial<AppConfig> = {};
  if (params.get('proxy')) fromQuery.gitProxyUrl = params.get('proxy')!;
  if (params.get('gitProxyUrl')) fromQuery.gitProxyUrl = params.get('gitProxyUrl')!;
  if (params.get('clone') || params.get('url')) {
    fromQuery.cloneUrl = (params.get('clone') || params.get('url'))!;
  }

  return {
    ...DEFAULT_CONFIG,
    ...stored,
    ...fromQuery,
    gitProxyUrl: normalizeProxyUrl(
      fromQuery.gitProxyUrl ?? stored.gitProxyUrl ?? DEFAULT_CONFIG.gitProxyUrl,
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
  return url.trim().replace(/\/+$/, '');
}

/** Probe git-proxy /healthz (or /). Returns latency ms or throws. */
export async function testGitProxy(proxyUrl: string, timeoutMs = 4000): Promise<{
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
    });
    const latencyMs = Math.round(performance.now() - started);
    const body = await res.text();
    return { ok: res.ok, status: res.status, latencyMs, body: body.slice(0, 200) };
  } finally {
    clearTimeout(t);
  }
}
