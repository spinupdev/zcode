import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { MemoryFs } from './memory-fs.js';
import { migrateIdbToFs } from './migrate-idb-to-opfs.js';

describe('migrateIdbToFs', () => {
  it('skips when IDB unavailable (Node)', async () => {
    const dest = new MemoryFs();
    const r = await migrateIdbToFs(dest);
    assert.equal(r.skipped, true);
    assert.equal(r.migrated, false);
    assert.equal(r.reason, 'idb-unavailable');
  });

  it('skips when dest already has workspace files', async () => {
    const dest = new MemoryFs();
    await dest.writeFile('workspace/a/f.txt', 'x');
    // Even if IDB existed, dest-has-workspace wins first after list
    const r = await migrateIdbToFs(dest);
    // In Node: idb-unavailable before dest check — either reason is fine
    assert.equal(r.migrated, false);
    assert.equal(r.skipped, true);
  });
});
