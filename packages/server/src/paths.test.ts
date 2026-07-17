import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { hasVscodeVendor, monorepoRoot, serverArtifactDir } from './index.js';

describe('server paths', () => {
  it('resolves monorepo root with package.json name zcode', () => {
    const root = monorepoRoot();
    const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')) as {
      name: string;
    };
    assert.equal(pkg.name, 'zcode');
  });

  it('points serverArtifactDir at dist/server', () => {
    assert.ok(serverArtifactDir().endsWith(`${path.sep}dist${path.sep}server`));
  });

  it('detects vendor/vscode in this repo', () => {
    assert.equal(hasVscodeVendor(), true);
  });
});
