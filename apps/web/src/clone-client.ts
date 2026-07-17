import type { CloneProgress, GitAuth, WorkspaceInfo } from '@zcode/protocol';
import type { ZCodeBrowserAgent } from '@zcode/browser-agent';
import type { WorkerIn, WorkerOut } from './git-worker.js';

function b64decode(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/**
 * Clone in a Web Worker (responsive UI), then import files into the main agent FS (IDB).
 */
export async function cloneInWorker(
  agent: ZCodeBrowserAgent,
  opts: {
    workspaceId: string;
    url: string;
    corsProxyUrl: string;
    depth?: number;
    auth?: GitAuth;
    onProgress?: (p: CloneProgress) => void;
  },
): Promise<WorkspaceInfo> {
  const worker = new Worker(new URL('./git-worker.js', import.meta.url), { type: 'module' });
  const requestId = crypto.randomUUID();

  try {
    const result = await new Promise<Extract<WorkerOut, { type: 'clone-done' }>>(
      (resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('clone worker timeout')), 10 * 60_000);

        worker.onmessage = (ev: MessageEvent<WorkerOut>) => {
          const msg = ev.data;
          if (msg.requestId !== requestId) return;
          if (msg.type === 'progress') {
            opts.onProgress?.(msg.progress);
            return;
          }
          if (msg.type === 'clone-done') {
            clearTimeout(timer);
            resolve(msg);
            return;
          }
          if (msg.type === 'error') {
            clearTimeout(timer);
            reject(new Error(msg.message));
          }
        };
        worker.onerror = (e) => {
          clearTimeout(timer);
          reject(e.error ?? new Error(e.message || 'worker error'));
        };

        const payload: WorkerIn = {
          type: 'clone',
          requestId,
          workspaceId: opts.workspaceId,
          url: opts.url,
          corsProxyUrl: opts.corsProxyUrl,
          depth: opts.depth,
          auth: opts.auth,
        };
        worker.postMessage(payload);
      },
    );

    opts.onProgress?.({ phase: 'resolving', message: 'persisting workspace…' });
    for (const f of result.files) {
      await agent.fs.writeFile(f.path, b64decode(f.dataB64));
    }
    if (!agent.store.get(result.workspace.id)) {
      agent.store.create(result.workspace.name, result.workspace.id);
    } else {
      agent.store.rename(result.workspace.id, result.workspace.name);
    }
    await agent.fs.writeFile(
      `workspace/${result.workspace.id}/.zcode-workspace.json`,
      JSON.stringify({
        id: result.workspace.id,
        name: result.workspace.name,
        createdAt: result.workspace.createdAt,
      }),
    );

    opts.onProgress?.({ phase: 'done', message: 'clone complete' });
    return result.workspace;
  } finally {
    worker.terminate();
  }
}
