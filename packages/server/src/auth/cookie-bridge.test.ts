import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { CookieTokenBridge, SESSION_COOKIE } from './cookie-bridge.js';

describe('CookieTokenBridge', () => {
  it('creates session cookie that resolves to connection token', () => {
    const bridge = new CookieTokenBridge('test-secret');
    const session = bridge.createSession('internal-token-abc');
    assert.ok(session.cookieValue.includes('.'));
    const header = `${SESSION_COOKIE}=${session.cookieValue}`;
    assert.equal(bridge.resolveConnectionToken(header), 'internal-token-abc');
    assert.equal(bridge.isAuthenticated(header), true);
  });

  it('rejects tampered cookies', () => {
    const bridge = new CookieTokenBridge('test-secret');
    const session = bridge.createSession('tok');
    const bad = `${SESSION_COOKIE}=${session.cookieValue}x`;
    assert.equal(bridge.resolveConnectionToken(bad), null);
  });

  it('does not expose token in Set-Cookie name value beyond session id signature', () => {
    const bridge = new CookieTokenBridge('test-secret');
    const session = bridge.createSession('super-secret-token');
    const setCookie = bridge.buildSetCookie(session.cookieValue);
    assert.match(setCookie, /HttpOnly/);
    assert.equal(setCookie.includes('super-secret-token'), false);
  });
});
