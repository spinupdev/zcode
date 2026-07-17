import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { DEFAULT_ALLOW_HOSTS } from './index.js';
import { resolveUpstream, startGitProxy } from './proxy.js';

describe('resolveUpstream', () => {
  it('builds https URL for allowlisted host', () => {
    const u = resolveUpstream(
      '/github.com/octocat/Hello-World.git/info/refs?service=git-upload-pack',
      DEFAULT_ALLOW_HOSTS,
    );
    assert.equal(u.hostname, 'github.com');
    assert.equal(u.pathname, '/octocat/Hello-World.git/info/refs');
    assert.equal(u.searchParams.get('service'), 'git-upload-pack');
  });

  it('rejects non-allowlisted hosts', () => {
    assert.throws(
      () => resolveUpstream('/evil.example.com/repo.git/info/refs', DEFAULT_ALLOW_HOSTS),
      /allowlisted/,
    );
  });

  it('blocks private IPs', () => {
    assert.throws(
      () => resolveUpstream('/169.254.169.254/latest/meta-data', ['169.254.169.254']),
      /blocked/,
    );
  });
});

describe('startGitProxy', () => {
  it('healthz and CORS preflight', async () => {
    const proxy = await startGitProxy({
      host: '127.0.0.1',
      port: 0,
      allowHosts: [...DEFAULT_ALLOW_HOSTS],
    });
    try {
      const h = await fetch(new URL('/healthz', proxy.url));
      assert.equal(h.status, 200);

      const opt = await fetch(new URL('/github.com/x', proxy.url), {
        method: 'OPTIONS',
        headers: { Origin: 'http://localhost:4173' },
      });
      assert.equal(opt.status, 204);
      assert.ok(opt.headers.get('access-control-allow-origin'));
    } finally {
      await proxy.close();
    }
  });
});
