import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { assertAuthorityShape, parseBootstrapFromSearchParams } from './url.js';

describe('parseBootstrapFromSearchParams', () => {
  it('defaults to empty browser-friendly input', () => {
    const input = parseBootstrapFromSearchParams('https://ide.example/');
    assert.deepEqual(input, {});
  });

  it('parses remote authority and ready flag', () => {
    const input = parseBootstrapFromSearchParams(
      'https://ide.example/?mode=remote&authority=localhost:8080&ready=1',
    );
    assert.equal(input.mode, 'remote');
    assert.equal(input.remoteAuthority, 'localhost:8080');
    assert.equal(input.connectionReady, true);
  });

  it('parses workspace uri', () => {
    const input = parseBootstrapFromSearchParams(
      'https://ide.example/?workspace=zcode-opfs://workspace/abc/',
    );
    assert.equal(input.workspaceUri, 'zcode-opfs://workspace/abc/');
  });

  it('rejects secret query params', () => {
    assert.throws(
      () => parseBootstrapFromSearchParams('https://ide.example/?tkn=secret'),
      /secret query/,
    );
    assert.throws(
      () => parseBootstrapFromSearchParams('https://ide.example/?cc=abc'),
      /secret query/,
    );
  });

  it('rejects custom authority prefixes', () => {
    assert.throws(
      () =>
        parseBootstrapFromSearchParams('https://ide.example/?authority=zcode%2Bfoo'),
      /invalid remoteAuthority/,
    );
  });
});

describe('assertAuthorityShape', () => {
  it('accepts host and host:port', () => {
    assert.doesNotThrow(() => assertAuthorityShape('localhost'));
    assert.doesNotThrow(() => assertAuthorityShape('localhost:8080'));
    assert.doesNotThrow(() => assertAuthorityShape('ses-1.example.com:443'));
  });

  it('rejects schemes and paths', () => {
    assert.throws(() => assertAuthorityShape('https://x'), /invalid/);
    assert.throws(() => assertAuthorityShape('host/path'), /invalid/);
  });
});
