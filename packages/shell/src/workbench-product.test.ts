import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildWorkbenchCreateOptions,
  configurationDefaultsForMode,
  workbenchProductScript,
} from './workbench-product.js';
import { browserCapabilities, remoteCapabilities } from '@zcode/protocol';

describe('buildWorkbenchCreateOptions', () => {
  it('browser mode uses zcode-opfs folder and no remoteAuthority', () => {
    const o = buildWorkbenchCreateOptions({ mode: 'browser', workspaceId: 'abc' });
    assert.equal(o.remoteAuthority, undefined);
    assert.equal(o.folderUri?.scheme, 'zcode-opfs');
    assert.equal(o.folderUri?.path, '/workspace/abc');
    assert.equal(o.productConfiguration.nameShort, 'ZCode');
    assert.equal(o.zcodeMode, 'browser');
    assert.equal(o.zcodeCapabilities?.terminal, false);
  });

  it('remote mode sets remoteAuthority and vscode-remote folder', () => {
    const o = buildWorkbenchCreateOptions({
      mode: 'remote',
      remoteAuthority: '127.0.0.1:8080',
    });
    assert.equal(o.remoteAuthority, '127.0.0.1:8080');
    assert.equal(o.folderUri?.scheme, 'vscode-remote');
    assert.equal(o.folderUri?.authority, '127.0.0.1:8080');
    assert.equal(o.zcodeCapabilities?.terminal, true);
    assert.equal(o.connectionReady, true);
  });

  it('embeds default builtin extension paths including diagnostics', () => {
    const o = buildWorkbenchCreateOptions({ mode: 'browser' });
    const paths = o.additionalBuiltinExtensions?.map((e) => e.path) ?? [];
    assert.ok(paths.includes('/extensions/zcode-browser-fs'));
    assert.ok(paths.includes('/extensions/zcode-git'));
    assert.ok(paths.includes('/extensions/zcode-diagnostics'));
  });

  it('embeds custom builtin extension paths with origin', () => {
    const o = buildWorkbenchCreateOptions({
      builtinExtensionPaths: ['/extensions/zcode-browser-fs'],
      origin: 'http://127.0.0.1:5000',
    });
    assert.equal(o.additionalBuiltinExtensions?.[0]?.path, '/extensions/zcode-browser-fs');
    assert.equal(o.additionalBuiltinExtensions?.[0]?.authority, '127.0.0.1:5000');
  });

  it('browser defaults soft-hide terminal; remote enables it', () => {
    const browser = configurationDefaultsForMode('browser', browserCapabilities());
    assert.equal(browser['terminal.integrated.enablePersistentSessions'], false);
    assert.equal(browser['workbench.colorTheme'], 'Default Dark Modern');
    const remote = configurationDefaultsForMode('remote', remoteCapabilities());
    assert.equal(remote['terminal.integrated.enablePersistentSessions'], true);
    assert.equal(remote['remote.autoForwardPorts'], true);
    assert.equal(remote['workbench.colorTheme'], 'Default Dark Modern');
  });

  it('serializes window.product script', () => {
    const s = workbenchProductScript(buildWorkbenchCreateOptions({ mode: 'browser' }));
    assert.match(s, /^window\.product = /);
    assert.match(s, /ZCode/);
    assert.match(s, /zcodeCapabilities/);
  });
});
