import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createZenFsMemory } from './zenfs-fs.js';

describe('ZenFsAgentFs (InMemory backend)', () => {
  it('write/read/readdir/exists/listFiles/rm', async () => {
    const fs = await createZenFsMemory();
    await fs.writeFile('workspace/demo/README.md', '# hi\n');
    await fs.writeFile('workspace/demo/src/a.ts', 'export {}\n');

    assert.equal(await fs.exists('workspace/demo/README.md'), true);
    assert.equal(await fs.exists('workspace/demo/src'), true);
    assert.equal(await fs.exists('workspace/missing'), false);

    const readme = new TextDecoder().decode(await fs.readFile('workspace/demo/README.md'));
    assert.equal(readme, '# hi\n');

    const top = await fs.readdir('workspace');
    assert.deepEqual(top, ['demo']);

    const files = await fs.listFiles!('workspace/demo');
    assert.ok(files.includes('workspace/demo/README.md'));
    assert.ok(files.includes('workspace/demo/src/a.ts'));

    await fs.rm('workspace/demo/src', { recursive: true });
    assert.equal(await fs.exists('workspace/demo/src/a.ts'), false);
    assert.equal(await fs.exists('workspace/demo/README.md'), true);

    const est = await fs.estimate();
    assert.ok(est.quota > 0);
  });

  it('mkdir creates parents for nested writes', async () => {
    const fs = await createZenFsMemory();
    await fs.mkdir('workspace/x/y');
    await fs.writeFile('workspace/x/y/z.txt', 'z');
    assert.deepEqual(await fs.readdir('workspace/x/y'), ['z.txt']);
  });

  /**
   * Regression: ZenFS raw readFile can return garbage for directories. AgentFs
   * must classify via stat, and readFile must throw EISDIR — otherwise the
   * workbench Explorer shows every folder as a non-expandable empty file.
   */
  it('stat distinguishes dirs from files; readFile rejects directories', async () => {
    const fs = await createZenFsMemory();
    await fs.writeFile('workspace/demo/src/lib/a.ts', 'export {}\n');
    await fs.writeFile('workspace/demo/README.md', '# hi\n');

    const dir = await fs.stat('workspace/demo/src');
    assert.equal(dir.kind, 'dir');
    assert.equal(dir.size, 0);

    const nested = await fs.stat('workspace/demo/src/lib');
    assert.equal(nested.kind, 'dir');

    const file = await fs.stat('workspace/demo/README.md');
    assert.equal(file.kind, 'file');
    assert.ok(file.size > 0);

    await assert.rejects(() => fs.readFile('workspace/demo/src'), (err: NodeJS.ErrnoException) => {
      assert.equal(err.code, 'EISDIR');
      return true;
    });

    // readdir children must classify correctly (Explorer contract)
    const kids = await fs.readdir('workspace/demo');
    assert.ok(kids.includes('src'));
    assert.ok(kids.includes('README.md'));
    for (const name of kids) {
      const st = await fs.stat(`workspace/demo/${name}`);
      if (name === 'src') assert.equal(st.kind, 'dir');
      if (name === 'README.md') assert.equal(st.kind, 'file');
    }
  });
});
