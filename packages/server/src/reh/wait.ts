/**
 * Wait helpers for REH readiness (R6 e2e / serve).
 */

export interface WaitForUrlOptions {
  /** Max wait ms (default 60s) */
  timeoutMs?: number;
  /** Poll interval ms (default 500) */
  intervalMs?: number;
  /** Optional cookie header (session after login) */
  cookie?: string;
  /** Accept these HTTP statuses (default [200]) */
  okStatuses?: number[];
  signal?: AbortSignal;
}

/**
 * Poll GET url until an ok status or timeout.
 * Used after REH spawn so cookie-proxy e2e does not race the server boot.
 */
export async function waitForUrl(
  url: string,
  opts: WaitForUrlOptions = {},
): Promise<{ status: number; body: string }> {
  const timeoutMs = opts.timeoutMs ?? 60_000;
  const intervalMs = opts.intervalMs ?? 500;
  const okStatuses = opts.okStatuses ?? [200];
  const deadline = Date.now() + timeoutMs;
  let lastErr: unknown;
  let lastStatus = 0;
  let lastBody = '';

  while (Date.now() < deadline) {
    if (opts.signal?.aborted) {
      throw new Error(`waitForUrl aborted: ${url}`);
    }
    try {
      const res = await fetch(url, {
        headers: opts.cookie ? { cookie: opts.cookie } : undefined,
        signal: opts.signal,
      });
      lastStatus = res.status;
      lastBody = await res.text();
      if (okStatuses.includes(res.status)) {
        return { status: res.status, body: lastBody };
      }
    } catch (err) {
      lastErr = err;
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }

  const detail =
    lastStatus > 0
      ? `last status ${lastStatus} body=${lastBody.slice(0, 200)}`
      : `last error ${lastErr instanceof Error ? lastErr.message : String(lastErr ?? 'none')}`;
  throw new Error(`waitForUrl timeout after ${timeoutMs}ms: ${url} (${detail})`);
}
