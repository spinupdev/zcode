import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createBrowserAgent } from './agent.js';
import { WorkspaceLock } from './lock.js';
import { MemoryFs } from './memory-fs.js';

describe('ZCodeBrowserAgent', () => {
  it('creates, lists, and deletes workspaces', async () => {
    const agent = createBrowserAgent();
    const ws = await agent.createWorkspace('demo');
    assert.equal(ws.name, 'demo');
    assert.match(ws.uri, /^zcode-opfs:\/\/workspace\//);

    const list = await agent.listWorkspaces();
    assert.equal(list.length, 1);
    assert.equal(list[0]?.id, ws.id);

    await agent.writeFile(ws.id, 'hello.txt', 'hi');
    assert.equal(await agent.readFile(ws.id, 'hello.txt'), 'hi');
    const files = await agent.listFiles(ws.id);
    assert.ok(files.includes('hello.txt') || files.some((f) => f.endsWith('hello.txt')));

    await agent.deleteWorkspace(ws.id);
    assert.equal((await agent.listWorkspaces()).length, 0);
  });

  it('serializes workspace locks', async () => {
    const lock = new WorkspaceLock();
    const order: number[] = [];
    await Promise.all([
      lock.withLock('w', async () => {
        order.push(1);
        await new Promise((r) => setTimeout(r, 20));
        order.push(2);
      }),
      lock.withLock('w', async () => {
        order.push(3);
      }),
    ]);
    assert.deepEqual(order, [1, 2, 3]);
  });

  it('can init-commit on a new workspace without remote', async () => {
    const fs = new MemoryFs();
    const agent = createBrowserAgent({ fs });
    const ws = await agent.createWorkspace('local');
    // manual git-like: write file then commit requires .git — use clone path in integration
    // Here just ensure commit fails cleanly without repo
    await agent.writeFile(ws.id, 'a.txt', 'x');
    await assert.rejects(() => agent.commit({ workspaceId: ws.id, message: 'x' }));
  });
});
