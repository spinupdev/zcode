/**
 * Web Worker: run isomorphic-git clone off the main thread so the UI can paint.
 */
import { createBrowserAgent, MemoryFs } from '@zcode/browser-agent';
import type { CloneProgress } from '@zcode/protocol';

export type WorkerIn =
  | {
      type: 'clone';
      requestId: string;
      workspaceId: string;
      url: string;
      corsProxyUrl: string;
      depth?: number;
    }
  | { type: 'ping'; requestId: string };

export type WorkerOut =
  | { type: 'progress'; requestId: string; progress: CloneProgress }
  | {
      type: 'clone-done';
      requestId: string;
      workspace: {
        id: string;
        name: string;
        uri: string;
        createdAt: string;
        approxBytes?: number;
      };
      /** Serialized file map for main-thread IDB persistence (path → base64) */
      files: Array<{ path: string; dataB64: string }>;
    }
  | { type: 'error'; requestId: string; message: string }
  | { type: 'pong'; requestId: string };

function b64encode(data: Uint8Array): string {
  let s = '';
  const chunk = 0x8000;
  for (let i = 0; i < data.length; i += chunk) {
    s += String.fromCharCode(...data.subarray(i, i + chunk));
  }
  return btoa(s);
}

// Workers use memory FS; main thread merges into IDB after clone
const agent = createBrowserAgent({ fs: new MemoryFs(), hydrateFromFs: false });

self.onmessage = (ev: MessageEvent<WorkerIn>) => {
  void handle(ev.data);
};

async function handle(msg: WorkerIn): Promise<void> {
  if (msg.type === 'ping') {
    post({ type: 'pong', requestId: msg.requestId });
    return;
  }

  if (msg.type !== 'clone') return;
  const { requestId } = msg;
  try {
    const workspace = await agent.clone({
      workspaceId: msg.workspaceId,
      url: msg.url,
      corsProxyUrl: msg.corsProxyUrl,
      depth: msg.depth ?? 1,
      onProgress: (progress) => {
        post({ type: 'progress', requestId, progress });
      },
    });

    const paths = await agent.listFiles(msg.workspaceId);
    const files: Array<{ path: string; dataB64: string }> = [];
    // include .git via raw fs walk
    const mem = agent.fs as MemoryFs;
    const all = (await mem.listFiles?.(`workspace/${msg.workspaceId}`)) ?? [];
    for (const full of all) {
      try {
        const data = await mem.readFile(full);
        files.push({ path: full, dataB64: b64encode(data) });
      } catch {
        /* skip */
      }
    }
    // also mark dirs by writing nothing — IDB fs mkdir on write path
    void paths;

    post({
      type: 'clone-done',
      requestId,
      workspace: {
        id: workspace.id,
        name: workspace.name,
        uri: workspace.uri,
        createdAt: workspace.createdAt,
        approxBytes: workspace.approxBytes,
      },
      files,
    });
  } catch (err) {
    post({
      type: 'error',
      requestId,
      message: err instanceof Error ? err.message : String(err),
    });
  }
}

function post(msg: WorkerOut): void {
  self.postMessage(msg);
}
