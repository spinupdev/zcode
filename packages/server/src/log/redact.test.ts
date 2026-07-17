import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { redactSecrets, redactString, safeJsonStringify } from './redact.js';

describe('secret redaction (M2)', () => {
  it('redacts connectionToken query fragments', () => {
    const s = redactString('GET /version?connectionToken=super-secret-xyz');
    assert.ok(!s.includes('super-secret-xyz'));
    assert.match(s, /REDACTED/);
  });

  it('redacts Bearer tokens and session cookies', () => {
    assert.ok(!redactString('Authorization: Bearer abc.def.ghi').includes('abc.def'));
    assert.ok(!redactString('Cookie: zcode_sess=signed.value.here').includes('signed.value'));
  });

  it('redacts object keys case-insensitively', () => {
    const r = redactSecrets({
      password: 'hunter2',
      connectionToken: 'tok',
      nested: { Authorization: 'Bearer x' },
      ok: 'visible',
    }) as Record<string, unknown>;
    assert.equal(r.password, '[REDACTED]');
    assert.equal(r.connectionToken, '[REDACTED]');
    assert.equal((r.nested as { Authorization: string }).Authorization, '[REDACTED]');
    assert.equal(r.ok, 'visible');
  });

  it('safeJsonStringify never leaks tkn=', () => {
    const s = safeJsonStringify({ url: 'http://x/?tkn=leak-me' });
    assert.ok(!s.includes('leak-me'));
  });
});
