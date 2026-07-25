import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  applySecurityHeaders,
  buildContentSecurityPolicy,
  cspHeaderName,
} from './csp.js';

describe('CSP draft (M2)', () => {
  it('includes self, wasm, and same-origin connect defaults', () => {
    const csp = buildContentSecurityPolicy();
    assert.match(csp, /default-src 'self'/);
    assert.match(csp, /wasm-unsafe-eval/);
    assert.match(csp, /connect-src[^;]*'self'/);
    assert.match(csp, /object-src 'none'/);
    assert.match(csp, /open-vsx\.org/);
    // Browser WASM runtimes (Pyodide)
    assert.match(csp, /cdn\.jsdelivr\.net/);
  });

  it('can omit Open VSX extension-src', () => {
    const csp = buildContentSecurityPolicy({ openVsx: false });
    assert.doesNotMatch(csp, /open-vsx/);
  });

  it('applies security headers', () => {
    const h: Record<string, string | number | string[]> = {};
    applySecurityHeaders(h);
    assert.ok(String(h['Content-Security-Policy']).includes("default-src 'self'"));
    assert.equal(h['X-Content-Type-Options'], 'nosniff');
    assert.equal(cspHeaderName(true), 'Content-Security-Policy-Report-Only');
  });

  it('adds COOP/COEP when crossOriginIsolation is requested', () => {
    const h: Record<string, string | number | string[]> = {};
    applySecurityHeaders(h, { crossOriginIsolation: true });
    assert.equal(h['Cross-Origin-Opener-Policy'], 'same-origin');
    assert.equal(h['Cross-Origin-Embedder-Policy'], 'credentialless');
  });
});
