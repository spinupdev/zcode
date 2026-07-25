import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { ExecError, runExec } from './exec.js';

describe('runExec', () => {
  it('runs node javascript and captures stdout', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'zcode-exec-'));
    try {
      const result = await runExec(root, {
        language: 'javascript',
        code: 'console.log("ra3-ok");',
      });
      assert.equal(result.exitCode, 0);
      assert.match(result.stdout, /ra3-ok/);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('runs relative path under workspace', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'zcode-exec-'));
    try {
      fs.writeFileSync(path.join(root, 'hi.js'), 'console.log("from-file");\n');
      const result = await runExec(root, {
        language: 'javascript',
        relativePath: 'hi.js',
      });
      assert.equal(result.exitCode, 0);
      assert.match(result.stdout, /from-file/);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('rejects path traversal', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'zcode-exec-'));
    try {
      await assert.rejects(
        () => runExec(root, { language: 'javascript', relativePath: '../x.js' }),
        ExecError,
      );
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('rejects unsupported languages', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'zcode-exec-'));
    try {
      await assert.rejects(
        () => runExec(root, { language: 'ruby', code: 'puts 1' }),
        /unsupported/,
      );
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
