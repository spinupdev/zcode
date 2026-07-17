import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { changeKindFromMatrix } from './git.js';

describe('changeKindFromMatrix', () => {
  it('treats 1/1/1 as clean', () => {
    assert.equal(changeKindFromMatrix(1, 1, 1), null);
  });

  it('detects untracked, modified, deleted, added', () => {
    assert.equal(changeKindFromMatrix(0, 2, 0), 'untracked');
    assert.equal(changeKindFromMatrix(1, 2, 1), 'modified');
    assert.equal(changeKindFromMatrix(1, 0, 1), 'deleted');
    assert.equal(changeKindFromMatrix(0, 2, 2), 'added');
  });
});
