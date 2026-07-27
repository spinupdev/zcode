import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  capabilitiesForMode,
  createWorkbenchLoadConfig,
  resolveMode,
} from './mode.js';

describe('resolveMode', () => {
  it('defaults to browser', () => {
    assert.equal(resolveMode({}), 'browser');
  });

  it('uses remote when authority is set', () => {
    assert.equal(resolveMode({ remoteAuthority: 'localhost:8080' }), 'remote');
  });

  it('honors explicit browser override', () => {
    assert.equal(
      resolveMode({ mode: 'browser', remoteAuthority: 'localhost:8080' }),
      'browser',
    );
  });
});

describe('createWorkbenchLoadConfig', () => {
  it('omits remoteAuthority in browser mode', () => {
    const cfg = createWorkbenchLoadConfig({
      workspaceUri: 'zcode-opfs://workspace/abc/',
    });
    assert.equal(cfg.remoteAuthority, undefined);
    assert.equal(cfg.workspaceUri, 'zcode-opfs://workspace/abc/');
    assert.equal(cfg.resolvedConnection, undefined);
  });

  it('sets authority and optional connection handle for remote', () => {
    const cfg = createWorkbenchLoadConfig({
      remoteAuthority: 'localhost:8080',
      connectionReady: true,
    });
    assert.equal(cfg.remoteAuthority, 'localhost:8080');
    assert.deepEqual(cfg.resolvedConnection, {
      ready: true,
      authority: 'localhost:8080',
    });
    assert.match(cfg.workspaceUri ?? '', /^vscode-remote:\/\//);
  });

  it('does not put a token string on the config', () => {
    const cfg = createWorkbenchLoadConfig({
      remoteAuthority: 'localhost:8080',
      connectionReady: true,
    });
    const json = JSON.stringify(cfg);
    assert.equal(json.includes('token'), false);
    assert.equal(json.includes('connectionToken'), false);
  });
});

describe('capabilitiesForMode', () => {
  it('enables terminal in browser mode (WASM Pseudoterminal)', () => {
    assert.equal(capabilitiesForMode('browser').terminal, true);
    assert.equal(capabilitiesForMode('browser').search, 'web-best-effort');
  });

  it('enables terminal and ripgrep in remote mode', () => {
    assert.equal(capabilitiesForMode('remote').terminal, true);
    assert.equal(capabilitiesForMode('remote').search, 'ripgrep');
  });

  it('lists browser WASM backends in browser mode', () => {
    const caps = capabilitiesForMode('browser');
    assert.deepEqual(caps.executionBackends, ['browser-python', 'browser-node']);
    assert.equal(caps.defaultExecutionBackend, 'browser-node');
  });

  it('prefers remote-reh when remote mode', () => {
    const caps = capabilitiesForMode('remote');
    assert.equal(caps.defaultExecutionBackend, 'remote-reh');
    assert.ok(caps.executionBackends?.includes('remote-reh'));
  });
});
