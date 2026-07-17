import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { DEFAULT_ALLOW_HOSTS, isHostAllowed } from './index.js';

describe('isHostAllowed', () => {
  it('allows exact hosts', () => {
    assert.equal(isHostAllowed('github.com', DEFAULT_ALLOW_HOSTS), true);
  });

  it('allows subdomains of allowlisted hosts', () => {
    assert.equal(isHostAllowed('api.github.com', DEFAULT_ALLOW_HOSTS), true);
  });

  it('denies unrelated hosts (SSRF)', () => {
    assert.equal(isHostAllowed('169.254.169.254', DEFAULT_ALLOW_HOSTS), false);
    assert.equal(isHostAllowed('evil.example.com', DEFAULT_ALLOW_HOSTS), false);
  });
});
