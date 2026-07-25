import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import {
  exportFilesV1,
  importFilesV1,
  parseFilesV1,
  safeRelPath,
  ImportError,
} from './files-import.js';

describe('safeRelPath', () => {
  it('accepts nested relative paths', () => {
    assert.equal(safeRelPath('src/main.py'), 'src/main.py');
  });

  it('rejects traversal', () => {
    assert.throws(() => safeRelPath('../etc/passwd'), ImportError);
    assert.throws(() => safeRelPath('foo/../../x'), ImportError);
  });
});

describe('importFilesV1 / exportFilesV1', () => {
  it('round-trips text files under a temp root', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'zcode-import-'));
    try {
      const payload = parseFilesV1({
        format: 'files-v1',
        workspaceId: 'default',
        files: {
          'hello.py': { encoding: 'utf8', data: 'print("hi")\n' },
          'src/a.js': { encoding: 'utf8', data: 'console.log(1)\n' },
        },
      });
      const result = importFilesV1(root, payload);
      assert.equal(result.fileCount, 2);
      assert.equal(fs.readFileSync(path.join(root, 'hello.py'), 'utf8'), 'print("hi")\n');
      assert.equal(fs.readFileSync(path.join(root, 'src/a.js'), 'utf8'), 'console.log(1)\n');

      const exported = exportFilesV1(root);
      assert.equal(exported.format, 'files-v1');
      assert.ok(exported.files['hello.py']);
      assert.equal(exported.files['hello.py']!.data, 'print("hi")\n');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('rejects empty file maps', () => {
    assert.throws(
      () => parseFilesV1({ format: 'files-v1', files: {} }),
      /empty/,
    );
  });
});
