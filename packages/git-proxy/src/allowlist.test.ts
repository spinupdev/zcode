import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  DEFAULT_ALLOW_HOSTS,
  DEFAULT_GIT_PROXY_PREFIX,
  isHostAllowed,
  matchesProxyPrefix,
  resolveUpstream,
  stripProxyPrefix,
} from './allowlist.js';

describe('isHostAllowed', () => {
  it('allows exact hosts', () => {
    assert.equal(isHostAllowed('github.com', DEFAULT_ALLOW_HOSTS), true);
  });

  it('allows subdomains of allowlisted hosts', () => {
    assert.equal(isHostAllowed('api.github.com', DEFAULT_ALLOW_HOSTS), true);
  });

  it('default list includes * so any public host is allowed at the allowlist layer', () => {
    assert.equal(isHostAllowed('git.example.com', DEFAULT_ALLOW_HOSTS), true);
    assert.equal(isHostAllowed('codeberg.org', DEFAULT_ALLOW_HOSTS), true);
  });

  it('tight list without * still denies unrelated hosts', () => {
    const tight = ['github.com', 'gitlab.com'] as const;
    assert.equal(isHostAllowed('evil.example.com', tight), false);
    assert.equal(isHostAllowed('github.com', tight), true);
  });

  it('* alone allows any hostname string (SSRF still blocked in resolveUpstream)', () => {
    assert.equal(isHostAllowed('anything.example', ['*']), true);
  });
});

describe('resolveUpstream SSRF', () => {
  it('still blocks link-local / private even when * is allowlisted', () => {
    assert.throws(
      () => resolveUpstream('/169.254.169.254/latest/meta-data', DEFAULT_ALLOW_HOSTS),
      /blocked host|not allowlisted/,
    );
    assert.throws(
      () => resolveUpstream('/127.0.0.1/repo.git/info/refs', DEFAULT_ALLOW_HOSTS),
      /blocked host|not allowlisted/,
    );
  });
});

describe('stripProxyPrefix', () => {
  it('strips /git-proxy mount', () => {
    assert.equal(
      stripProxyPrefix(
        '/git-proxy/github.com/octocat/Hello-World.git/info/refs?service=git-upload-pack',
        DEFAULT_GIT_PROXY_PREFIX,
      ),
      '/github.com/octocat/Hello-World.git/info/refs?service=git-upload-pack',
    );
  });

  it('maps health roots', () => {
    assert.equal(stripProxyPrefix('/git-proxy', DEFAULT_GIT_PROXY_PREFIX), '/');
    assert.equal(stripProxyPrefix('/git-proxy/', DEFAULT_GIT_PROXY_PREFIX), '/');
    assert.equal(stripProxyPrefix('/git-proxy/healthz', DEFAULT_GIT_PROXY_PREFIX), '/healthz');
  });
});

describe('matchesProxyPrefix', () => {
  it('matches prefix paths only', () => {
    assert.equal(matchesProxyPrefix('/git-proxy', '/git-proxy'), true);
    assert.equal(matchesProxyPrefix('/git-proxy/healthz', '/git-proxy'), true);
    assert.equal(matchesProxyPrefix('/index.html', '/git-proxy'), false);
  });
});

describe('resolveUpstream', () => {
  it('builds https URL for allowlisted host', () => {
    const u = resolveUpstream(
      '/github.com/octocat/Hello-World.git/info/refs?service=git-upload-pack',
      DEFAULT_ALLOW_HOSTS,
    );
    assert.equal(u.hostname, 'github.com');
    assert.equal(u.pathname, '/octocat/Hello-World.git/info/refs');
  });
});
