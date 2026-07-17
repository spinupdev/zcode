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
});
