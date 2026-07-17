import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import {
  findRehBinary,
  hasRehPackageMarker,
  hasRunnableRehArtifact,
  inspectRehArtifact,
} from './artifact.js';
import { monorepoRoot } from '../paths.js';

describe('REH artifact helpers (R2c/R6)', () => {
  it('findRehBinary returns null for empty dir', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zcode-reh-empty-'));
    try {
      assert.equal(findRehBinary(dir), null);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('findRehBinary locates bin/code-server-oss', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zcode-reh-bin-'));
    try {
      fs.mkdirSync(path.join(dir, 'bin'), { recursive: true });
      const bin = path.join(dir, 'bin', 'code-server-oss');
      fs.writeFileSync(bin, '#!/bin/sh\necho mock\n', { mode: 0o755 });
      assert.equal(findRehBinary(dir), bin);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('inspectRehArtifact is null without dist/server marker in a temp root', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'zcode-root-'));
    try {
      assert.equal(inspectRehArtifact(root), null);
      assert.equal(hasRehPackageMarker(root), false);
      assert.equal(hasRunnableRehArtifact(root), false);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('inspectRehArtifact reads marker without requiring binary', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'zcode-root-'));
    try {
      const serverDir = path.join(root, 'dist', 'server');
      fs.mkdirSync(serverDir, { recursive: true });
      fs.writeFileSync(
        path.join(serverDir, '.zcode-build.json'),
        JSON.stringify({ kind: 'vscode-reh', platform: 'linux', arch: 'x64' }),
      );
      const info = inspectRehArtifact(root);
      assert.ok(info);
      assert.equal(info.binary, null);
      assert.equal(info.build?.kind, 'vscode-reh');
      assert.equal(hasRehPackageMarker(root), true);
      assert.equal(hasRunnableRehArtifact(root), false);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('reports monorepo artifact status without throwing', () => {
    // May or may not exist on this machine — must not throw.
    const root = monorepoRoot();
    const info = inspectRehArtifact(root);
    if (info) {
      assert.ok(info.markerPath.endsWith('.zcode-build.json'));
    } else {
      assert.equal(hasRehPackageMarker(root), false);
    }
  });
});
