import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  assertRemoteReady,
  bootstrapFromInput,
  bootstrapFromUrl,
  formatBootstrapSummary,
  isTestWebHarnessAllowed,
} from './bootstrap.js';

describe('bootstrapFromUrl', () => {
  it('bootstraps browser mode', () => {
    const r = bootstrapFromUrl('https://ide.example/?workspace=zcode-opfs://workspace/1/');
    assert.equal(r.mode, 'browser');
    assert.equal(r.workbench.remoteAuthority, undefined);
    assert.equal(r.chrome.showTerminal, false);
    assert.equal(r.capabilities.search, 'web-best-effort');
  });

  it('bootstraps remote mode when ready', () => {
    const r = bootstrapFromUrl(
      'https://ide.example/?authority=127.0.0.1:8080&ready=1',
    );
    assert.equal(r.mode, 'remote');
    assert.equal(r.workbench.remoteAuthority, '127.0.0.1:8080');
    assert.equal(r.workbench.resolvedConnection?.ready, true);
    assert.equal(r.chrome.showTerminal, true);
    assert.doesNotThrow(() => assertRemoteReady(r));
  });

  it('assertRemoteReady fails without cookie-ready flag', () => {
    const r = bootstrapFromInput({ remoteAuthority: 'localhost:8080' });
    assert.throws(() => assertRemoteReady(r), /connection ready/);
  });
});

describe('isTestWebHarnessAllowed', () => {
  it('is false in production', () => {
    assert.equal(isTestWebHarnessAllowed({ NODE_ENV: 'production' }), false);
  });

  it('requires explicit allow flag in development', () => {
    assert.equal(isTestWebHarnessAllowed({ NODE_ENV: 'development' }), false);
    assert.equal(
      isTestWebHarnessAllowed({ NODE_ENV: 'development', ZCODE_ALLOW_TEST_WEB: '1' }),
      true,
    );
  });

  it('does not throw when process.env is unavailable (browser-style)', () => {
    // Explicit empty env mimics browser default from currentEnv()
    assert.equal(isTestWebHarnessAllowed({}), false);
  });
});

describe('formatBootstrapSummary', () => {
  it('includes mode and authority', () => {
    const text = formatBootstrapSummary(
      bootstrapFromUrl('https://x/?authority=localhost:9&ready=1'),
    );
    assert.match(text, /mode=remote/);
    assert.match(text, /localhost:9/);
  });
});
