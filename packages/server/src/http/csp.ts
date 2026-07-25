/**
 * Content-Security-Policy draft for ZCode workbench / SPA (M2).
 * VS Code Web needs eval/wasm; tune carefully when pin upgrades.
 */

export interface CspOptions {
  /** When true, allow https Open VSX + same-origin only for connect (default). */
  openVsx?: boolean;
  /** Extra connect-src hosts (e.g. custom gallery). */
  extraConnectSrc?: string[];
  /**
   * Extra script-src hosts (e.g. Pyodide CDN for browser WASM runtimes).
   * Default includes jsDelivr for Pyodide (WB1).
   */
  extraScriptSrc?: string[];
  /** When false, do not add default Pyodide CDN script hosts. */
  browserWasm?: boolean;
  /** Report-only mode (header Content-Security-Policy-Report-Only). */
  reportOnly?: boolean;
  /**
   * Cross-origin isolation for WebContainers / SharedArrayBuffer.
   * Enable with ZCODE_COI=1 — may break third-party assets without CORP.
   */
  crossOriginIsolation?: boolean;
}

/** Build a CSP header value for same-origin MVP co-serve. */
export function buildContentSecurityPolicy(opts: CspOptions = {}): string {
  const openVsx = opts.openVsx !== false;
  const browserWasm = opts.browserWasm !== false;
  const connect = ["'self'", 'https:', 'wss:', 'ws:', ...(opts.extraConnectSrc ?? [])];
  // Browser mode talks to same-origin /git-proxy; remote uses same-origin WS to REH proxy.
  const extensionSrc = openVsx
    ? ["'self'", 'https://open-vsx.org', 'https://*.open-vsx.org']
    : ["'self'"];

  const scriptSrc = [
    "'self'",
    "'wasm-unsafe-eval'",
    "'unsafe-eval'",
    "'unsafe-inline'",
    // Pyodide / browser WASM runtimes (zcode-runtime-python)
    ...(browserWasm
      ? ['https://cdn.jsdelivr.net', 'https://cdn.jsdelivr.net/pyodide/']
      : []),
    ...(opts.extraScriptSrc ?? []),
  ];

  const directives: string[] = [
    "default-src 'self'",
    // Monaco / VS Code web historically need unsafe-eval; wasm-unsafe-eval for modern WASM.
    `script-src ${scriptSrc.join(' ')}`,
    "worker-src 'self' blob:",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: https: blob:",
    "font-src 'self' data:",
    `connect-src ${connect.join(' ')}`,
    // Built-in extensions are same-origin; marketplace optional
    `extension-src ${extensionSrc.join(' ')}`,
    "frame-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ];

  return directives.join('; ');
}

export function cspHeaderName(reportOnly = false): string {
  return reportOnly ? 'Content-Security-Policy-Report-Only' : 'Content-Security-Policy';
}

/** Apply CSP (+ baseline security headers) onto a headers record. */
export function applySecurityHeaders(
  headers: Record<string, string | number | string[]>,
  opts: CspOptions = {},
): void {
  const coi =
    opts.crossOriginIsolation === true ||
    process.env.ZCODE_COI === '1' ||
    process.env.ZCODE_CROSS_ORIGIN_ISOLATION === '1';
  headers[cspHeaderName(opts.reportOnly)] = buildContentSecurityPolicy(opts);
  headers['X-Content-Type-Options'] = 'nosniff';
  headers['Referrer-Policy'] = 'no-referrer';
  headers['X-Frame-Options'] = 'SAMEORIGIN';
  if (coi) {
    // Enables SharedArrayBuffer for WebContainers (prefer with same-origin assets).
    headers['Cross-Origin-Opener-Policy'] = 'same-origin';
    headers['Cross-Origin-Embedder-Policy'] = 'credentialless';
  }
}
