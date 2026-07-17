import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createSessionController } from './session-controller.js';

describe('createSessionController', () => {
  it('creates a browser session', () => {
    const session = createSessionController({});
    assert.equal(session.mode, 'browser');
    assert.equal(session.capabilities().terminal, false);
    assert.equal(session.createWorkbenchLoadConfig().remoteAuthority, undefined);
  });

  it('creates a remote session when authority is set', () => {
    const session = createSessionController({
      remoteAuthority: '127.0.0.1:8080',
      connectionReady: true,
    });
    assert.equal(session.mode, 'remote');
    assert.equal(session.capabilities().terminal, true);
    assert.equal(session.createWorkbenchLoadConfig().remoteAuthority, '127.0.0.1:8080');
  });
});
