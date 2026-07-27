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
    assert.equal(o.zcodeCapabilities?.terminal, true);
  });

  it('sets same-origin webviewEndpoint (not vscode-cdn)', () => {
    const o = buildWorkbenchCreateOptions({
      mode: 'browser',
      origin: 'http://127.0.0.1:5000',
    });
    assert.equal(
      o.webviewEndpoint,
      'http://127.0.0.1:5000/vscode/out/vs/workbench/contrib/webview/browser/pre',
    );
    assert.match(
      String(o.productConfiguration.webviewContentExternalBaseUrlTemplate),
      /127\.0\.0\.1:5000\/vscode\/out\/vs\/workbench\/contrib\/webview\/browser\/pre\//,
    );
    assert.doesNotMatch(String(o.webviewEndpoint), /vscode-cdn\.net/);
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

  it('embeds default builtin extension paths including diagnostics + language packs', () => {
    const o = buildWorkbenchCreateOptions({ mode: 'browser' });
    const paths = o.additionalBuiltinExtensions?.map((e) => e.path) ?? [];
    assert.ok(paths.includes('/extensions/zcode-browser-fs'));
    assert.ok(paths.includes('/extensions/zcode-git'));
    assert.ok(paths.includes('/extensions/zcode-diagnostics'));
    assert.ok(paths.includes('/extensions/zcode-runtime-core'));
    assert.ok(paths.includes('/extensions/zcode-runtime-python'));
    assert.ok(paths.includes('/extensions/zcode-runtime-node'));
    assert.ok(paths.includes('/extensions/zcode-runtime-remote'));
    assert.ok(paths.includes('/extensions/zcode-remote'));
    assert.ok(paths.includes('/extensions/vscode-icons'));
    assert.ok(paths.includes('/extensions/github-vscode-theme'));
    assert.ok(paths.includes('/extensions/terraform'));
    assert.ok(paths.includes('/extensions/hcl'));
    assert.ok(paths.includes('/extensions/nix'));
    assert.ok(paths.includes('/extensions/kotlin'));
    assert.ok(paths.includes('/extensions/solidity'));
    assert.ok(paths.includes('/extensions/zig'));
    // TextMate language packs (syntax highlighting)
    assert.ok(paths.includes('/vscode/extensions/javascript'));
    assert.ok(paths.includes('/vscode/extensions/typescript-basics'));
    assert.ok(paths.includes('/vscode/extensions/python'));
    assert.ok(paths.includes('/vscode/extensions/go'));
    assert.ok(paths.includes('/vscode/extensions/rust'));
    assert.ok(paths.includes('/vscode/extensions/theme-defaults'));
    assert.ok(paths.length >= 40, `expected 40+ builtins, got ${paths.length}`);
  });

  it('embeds custom builtin extension paths with origin', () => {
    const o = buildWorkbenchCreateOptions({
      builtinExtensionPaths: ['/extensions/zcode-browser-fs'],
      origin: 'http://127.0.0.1:5000',
    });
    assert.equal(o.additionalBuiltinExtensions?.[0]?.path, '/extensions/zcode-browser-fs');
    assert.equal(o.additionalBuiltinExtensions?.[0]?.authority, '127.0.0.1:5000');
  });

  it('browser soft-hides panel but prefers WebContainer profile; remote enables PTY', () => {
    const browser = configurationDefaultsForMode('browser', browserCapabilities());
    assert.equal(browser['terminal.integrated.enablePersistentSessions'], false);
    assert.equal(browser['terminal.integrated.defaultProfile.linux'], 'WebContainer Shell');
    assert.equal(browser['workbench.colorTheme'], 'GitHub Dark Default');
    assert.equal(browser['workbench.preferredLightColorTheme'], 'GitHub Light Default');
    assert.equal(browser['workbench.preferredDarkColorTheme'], 'GitHub Dark Default');
    assert.equal(browser['workbench.iconTheme'], 'vscode-icons');
    assert.equal(browser['window.autoDetectColorScheme'], true);
    const remote = configurationDefaultsForMode('remote', remoteCapabilities());
    assert.equal(remote['terminal.integrated.enablePersistentSessions'], true);
    assert.equal(remote['remote.autoForwardPorts'], true);
    assert.equal(remote['workbench.colorTheme'], 'GitHub Dark Default');
    assert.equal(remote['workbench.iconTheme'], 'vscode-icons');
    assert.equal(remote['window.autoDetectColorScheme'], true);
  });

  it('serializes window.product script', () => {
    const s = workbenchProductScript(buildWorkbenchCreateOptions({ mode: 'browser' }));
    assert.match(s, /^window\.product = /);
    assert.match(s, /ZCode/);
    assert.match(s, /zcodeCapabilities/);
  });
});
