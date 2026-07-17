import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  createPasswordVerifier,
  hashPassword,
  LoginRateLimiter,
  verifyPassword,
} from './password.js';

describe('password hashing', () => {
  it('round-trips scrypt hashes', () => {
    const h = hashPassword('s3cret');
    assert.equal(verifyPassword('s3cret', h), true);
    assert.equal(verifyPassword('wrong', h), false);
  });

  it('createPasswordVerifier accepts plaintext once', () => {
    const v = createPasswordVerifier('hello');
    assert.equal(v.verify('hello'), true);
    assert.equal(v.verify('nope'), false);
  });
});

describe('LoginRateLimiter', () => {
  it('locks out after max failures', () => {
    const lim = new LoginRateLimiter(3, 60_000);
    lim.recordFailure('ip');
    lim.recordFailure('ip');
    lim.recordFailure('ip');
    assert.throws(() => lim.assertAllowed('ip'), /too many attempts/);
  });
});
