import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createBrowserAgent } from './agent.js';
import { WorkspaceLock } from './lock.js';

describe('ZCodeBrowserAgent', () => {
  it('creates, lists, and deletes workspaces', async () => {
    const agent = createBrowserAgent();
    const ws = await agent.createWorkspace('demo');
    assert.equal(ws.name, 'demo');
    assert.match(ws.uri, /^zcode-opfs:\/\/workspace\//);

    const list = await agent.listWorkspaces();
    assert.equal(list.length, 1);
    assert.equal(list[0]?.id, ws.id);

    const est = await agent.storageEstimate();
    assert.ok(est.usage >= 0);
    assert.ok(est.quota > 0);

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

  it('rejects clone until B4', async () => {
    const agent = createBrowserAgent();
    const ws = await agent.createWorkspace('x');
    await assert.rejects(
      () =>
        agent.clone({
          workspaceId: ws.id,
          url: 'https://github.com/example/repo.git',
          corsProxyUrl: 'http://127.0.0.1:8787',
        }),
      /B4/,
    );
  });
});
