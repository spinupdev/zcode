import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { isSpaDebugEnabled, spaDebugStatus } from './spa-debug.js';

describe('isSpaDebugEnabled', () => {
  it('enables when NODE_ENV is development/dev/test', () => {
    assert.equal(isSpaDebugEnabled({ NODE_ENV: 'development' }), true);
    assert.equal(isSpaDebugEnabled({ NODE_ENV: 'dev' }), true);
    assert.equal(isSpaDebugEnabled({ NODE_ENV: 'test' }), true);
  });

  it('enables when ZCODE_ENV is development/dev', () => {
    assert.equal(isSpaDebugEnabled({ ZCODE_ENV: 'development' }), true);
    assert.equal(isSpaDebugEnabled({ ZCODE_ENV: 'dev' }), true);
  });

  it('disables when NODE_ENV or ZCODE_ENV is production', () => {
    assert.equal(isSpaDebugEnabled({ NODE_ENV: 'production' }), false);
    assert.equal(isSpaDebugEnabled({ NODE_ENV: 'prod' }), false);
    assert.equal(isSpaDebugEnabled({ ZCODE_ENV: 'production' }), false);
    assert.equal(
      isSpaDebugEnabled({ NODE_ENV: 'development', ZCODE_ENV: 'production' }),
      false,
    );
  });

  it('enables when env is unset (local dogfood)', () => {
    assert.equal(isSpaDebugEnabled({}), true);
  });

  it('respects ZCODE_SPA_DEBUG override', () => {
    assert.equal(isSpaDebugEnabled({ NODE_ENV: 'production', ZCODE_SPA_DEBUG: '1' }), true);
    assert.equal(isSpaDebugEnabled({ NODE_ENV: 'development', ZCODE_SPA_DEBUG: '0' }), false);
    assert.equal(isSpaDebugEnabled({ ZCODE_SPA_DEBUG: 'false' }), false);
  });

  it('spaDebugStatus reports reason', () => {
    const s = spaDebugStatus({ NODE_ENV: 'production' });
    assert.equal(s.enabled, false);
    assert.match(s.reason, /production/);
  });
});
