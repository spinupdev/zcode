import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  defaultBrowserExecutionBackends,
  disconnectedConnectionState,
  remoteExecutionBackendInfo,
  resolveDefaultExecutionBackend,
} from './execution.js';

describe('disconnectedConnectionState', () => {
  it('starts disconnected with no scope', () => {
    assert.deepEqual(disconnectedConnectionState(), {
      remote: 'disconnected',
      scope: 'none',
    });
  });
});

describe('resolveDefaultExecutionBackend', () => {
  const available = [...defaultBrowserExecutionBackends(), remoteExecutionBackendInfo()];

  it('picks browser-python for python when disconnected', () => {
    assert.equal(
      resolveDefaultExecutionBackend('python', disconnectedConnectionState(), available),
      'browser-python',
    );
  });

  it('picks browser-node for javascript when disconnected', () => {
    assert.equal(
      resolveDefaultExecutionBackend('javascript', disconnectedConnectionState(), available),
      'browser-node',
    );
  });

  it('prefers remote-reh when attached execution scope', () => {
    assert.equal(
      resolveDefaultExecutionBackend(
        'python',
        { remote: 'attached', scope: 'execution', authority: '127.0.0.1:8080' },
        available,
      ),
      'remote-reh',
    );
  });

  it('returns none when no matching backend', () => {
    assert.equal(
      resolveDefaultExecutionBackend('rust', disconnectedConnectionState(), available),
      'none',
    );
  });
});
