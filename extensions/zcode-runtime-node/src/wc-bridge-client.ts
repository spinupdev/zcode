/**
 * Client for the main-thread WebContainer bridge (BroadcastChannel).
 * Extensions run in a Worker; WC boots on the workbench page.
 */
export const WC_CHANNEL = 'zcode-webcontainer-v1';

export type BridgeStatusPhase =
  | 'idle'
  | 'downloading'
  | 'booting'
  | 'mounting'
  | 'ready'
  | 'error';

export type BridgeStatus = { phase: BridgeStatusPhase; message?: string };

type Pending = {
  resolve: (v: unknown) => void;
  reject: (e: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

function newId(): string {
  return `zcode-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export class WcBridgeClient {
  private bc: BroadcastChannel | null = null;
  private readonly pending = new Map<string, Pending>();
  private readonly statusListeners = new Set<(s: BridgeStatus) => void>();
  private readonly outputListeners = new Map<string, Set<(data: string) => void>>();
  private readonly exitListeners = new Map<string, Set<(code: number) => void>>();
  private lastStatus: BridgeStatus = { phase: 'idle' };
  private alive = false;

  connect(): void {
    if (this.bc) return;
    if (typeof BroadcastChannel === 'undefined') {
      throw new Error('BroadcastChannel not available in this extension host');
    }
    this.bc = new BroadcastChannel(WC_CHANNEL);
    this.bc.onmessage = (ev) => this.onMessage(ev.data);
    // Probe bridge
    void this.ping().then(
      () => {
        this.alive = true;
      },
      () => {
        this.alive = false;
      },
    );
  }

  dispose(): void {
    for (const [, p] of this.pending) {
      clearTimeout(p.timer);
      p.reject(new Error('bridge disposed'));
    }
    this.pending.clear();
    try {
      this.bc?.close();
    } catch {
      /* ignore */
    }
    this.bc = null;
  }

  onStatus(listener: (s: BridgeStatus) => void): { dispose(): void } {
    this.statusListeners.add(listener);
    // Replay last
    try {
      listener(this.lastStatus);
    } catch {
      /* ignore */
    }
    return {
      dispose: () => {
        this.statusListeners.delete(listener);
      },
    };
  }

  getLastStatus(): BridgeStatus {
    return this.lastStatus;
  }

  isBridgeAlive(): boolean {
    return this.alive;
  }

  private emitStatus(s: BridgeStatus): void {
    this.lastStatus = s;
    for (const l of this.statusListeners) {
      try {
        l(s);
      } catch {
        /* ignore */
      }
    }
  }

  private onMessage(msg: Record<string, unknown>): void {
    if (!msg || typeof msg !== 'object') return;
    const type = msg.type as string;

    if (type === 'status') {
      this.emitStatus({
        phase: (msg.phase as BridgeStatusPhase) || 'idle',
        message: msg.message as string | undefined,
      });
      return;
    }

    if (type === 'output' && typeof msg.sessionId === 'string') {
      const listeners = this.outputListeners.get(msg.sessionId);
      if (listeners) {
        for (const l of listeners) l(String(msg.data ?? ''));
      }
      return;
    }

    if (type === 'exit' && typeof msg.sessionId === 'string') {
      const listeners = this.exitListeners.get(msg.sessionId);
      if (listeners) {
        for (const l of listeners) l(Number(msg.code ?? 0));
      }
      return;
    }

    const id = msg.id as string | undefined;
    if (!id || !this.pending.has(id)) return;
    const p = this.pending.get(id)!;
    this.pending.delete(id);
    clearTimeout(p.timer);

    if (type === 'pong') {
      this.alive = true;
      p.resolve(msg);
      return;
    }
    if (type === 'boot-result' || type === 'spawn-result' || type === 'mount-result') {
      if (msg.ok) p.resolve(msg);
      else p.reject(new Error(String(msg.error || 'bridge request failed')));
      return;
    }
  }

  private request(
    payload: Record<string, unknown>,
    timeoutMs = 120_000,
  ): Promise<Record<string, unknown>> {
    this.connect();
    if (!this.bc) return Promise.reject(new Error('bridge not connected'));
    const id = newId();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(
          new Error(
            'WebContainer bridge timeout — is wc-bridge.js loaded on the workbench page?',
          ),
        );
      }, timeoutMs);
      this.pending.set(id, {
        resolve: (v) => resolve(v as Record<string, unknown>),
        reject,
        timer,
      });
      this.bc!.postMessage({ ...payload, id });
    });
  }

  async ping(timeoutMs = 3000): Promise<{ ready: boolean; isolated: boolean }> {
    const res = await this.request({ type: 'ping' }, timeoutMs);
    return {
      ready: !!res.ready,
      isolated: !!res.isolated,
    };
  }

  async prefetch(cdnUrl?: string): Promise<void> {
    await this.request({ type: 'prefetch', cdnUrl }, 180_000);
  }

  async boot(cdnUrl?: string): Promise<void> {
    await this.request({ type: 'boot', cdnUrl }, 180_000);
  }

  async mount(tree: Record<string, unknown>): Promise<void> {
    await this.request({ type: 'mount', tree }, 60_000);
  }

  async spawnShell(opts: {
    cols: number;
    rows: number;
    onOutput: (data: string) => void;
    onExit: (code: number) => void;
  }): Promise<{ sessionId: string; write: (data: string) => void; resize: (c: number, r: number) => void; kill: () => void }> {
    const sessionId = newId();
    const outSet = new Set<(d: string) => void>([opts.onOutput]);
    const exitSet = new Set<(c: number) => void>([opts.onExit]);
    this.outputListeners.set(sessionId, outSet);
    this.exitListeners.set(sessionId, exitSet);

    try {
      await this.request(
        {
          type: 'spawn-shell',
          sessionId,
          cols: opts.cols,
          rows: opts.rows,
        },
        180_000,
      );
    } catch (err) {
      this.outputListeners.delete(sessionId);
      this.exitListeners.delete(sessionId);
      throw err;
    }

    return {
      sessionId,
      write: (data: string) => {
        this.bc?.postMessage({ type: 'input', sessionId, data });
      },
      resize: (cols: number, rows: number) => {
        this.bc?.postMessage({ type: 'resize', sessionId, cols, rows });
      },
      kill: () => {
        this.bc?.postMessage({ type: 'kill', sessionId });
        this.outputListeners.delete(sessionId);
        this.exitListeners.delete(sessionId);
      },
    };
  }
}

let singleton: WcBridgeClient | null = null;

export function getWcBridge(): WcBridgeClient {
  if (!singleton) {
    singleton = new WcBridgeClient();
    try {
      singleton.connect();
    } catch {
      /* connect fails later on use */
    }
  }
  return singleton;
}
