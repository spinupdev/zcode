import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildWorkbenchCreateOptions, workbenchProductScript } from './workbench-product.js';

describe('buildWorkbenchCreateOptions', () => {
  it('browser mode uses zcode-opfs folder and no remoteAuthority', () => {
    const o = buildWorkbenchCreateOptions({ mode: 'browser', workspaceId: 'abc' });
    assert.equal(o.remoteAuthority, undefined);
    assert.equal(o.folderUri?.scheme, 'zcode-opfs');
    assert.equal(o.folderUri?.path, '/workspace/abc');
    assert.equal(o.productConfiguration.nameShort, 'ZCode');
  });

  it('remote mode sets remoteAuthority and vscode-remote folder', () => {
    const o = buildWorkbenchCreateOptions({
      mode: 'remote',
      remoteAuthority: '127.0.0.1:8080',
    });
    assert.equal(o.remoteAuthority, '127.0.0.1:8080');
    assert.equal(o.folderUri?.scheme, 'vscode-remote');
    assert.equal(o.folderUri?.authority, '127.0.0.1:8080');
  });

  it('embeds builtin extension paths', () => {
    const o = buildWorkbenchCreateOptions({
      builtinExtensionPaths: ['/extensions/zcode-browser-fs'],
    });
    assert.equal(o.additionalBuiltinExtensions?.[0]?.path, '/extensions/zcode-browser-fs');
  });

  it('serializes window.product script', () => {
    const s = workbenchProductScript(buildWorkbenchCreateOptions({ mode: 'browser' }));
    assert.match(s, /^window\.product = /);
    assert.match(s, /ZCode/);
  });
});
