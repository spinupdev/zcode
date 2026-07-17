import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createBrowserAgent } from './agent.js';
import { MemoryFs } from './memory-fs.js';

describe('searchWorkspace', () => {
  it('finds lines matching query', async () => {
    const fs = new MemoryFs();
    const agent = createBrowserAgent({ fs, hydrateFromFs: false });
    const ws = await agent.createWorkspace('s');
    await agent.writeFile(ws.id, 'src/a.ts', 'const hello = 1;\nconst world = 2;\n');
    await agent.writeFile(ws.id, 'README.md', '# Hello\n\nZCode demo\n');

    const hits = await agent.search({ workspaceId: ws.id, query: 'hello' });
    assert.ok(hits.length >= 2);
    assert.ok(hits.some((h) => h.path === 'src/a.ts'));
    assert.ok(hits.some((h) => h.path === 'README.md'));
  });
});
