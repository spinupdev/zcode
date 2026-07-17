import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const cli = path.join(path.dirname(fileURLToPath(import.meta.url)), 'cli.js');

function run(args: string[]) {
  return spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8' });
}

describe('zcode cli', () => {
  it('prints help', () => {
    const r = run(['help']);
    assert.equal(r.status, 0);
    assert.match(r.stdout, /ZCode/);
  });

  it('prints version', () => {
    const r = run(['version']);
    assert.equal(r.status, 0);
    assert.match(r.stdout, /0\.0\.0/);
  });

  it('exits non-zero for unimplemented git-proxy', () => {
    const r = run(['git-proxy']);
    assert.notEqual(r.status, 0);
  });
});
