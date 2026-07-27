/**
 * Main-thread WebContainer bridge for ZCode.
 *
 * VS Code web extensions run in a Worker (no DOM). WebContainers need the
 * window/document to boot. This script runs on the workbench page and talks
 * to extensions via BroadcastChannel('zcode-webcontainer-v1').
 */
(function () {
  const CHANNEL = 'zcode-webcontainer-v1';
  const DEFAULT_CDN =
    'https://cdn.jsdelivr.net/npm/@webcontainer/api@1.6.1/+esm';

  /** @type {BroadcastChannel} */
  const bc = new BroadcastChannel(CHANNEL);

  /** @type {import('@webcontainer/api').WebContainer | null} */
  let wc = null;
  /** @type {Promise<void> | null} */
  let bootPromise = null;
  /** @type {Map<string, { proc: any, writer: WritableStreamDefaultWriter<string> }>} */
  const shells = new Map();

  function emitStatus(phase, message) {
    bc.postMessage({ type: 'status', phase, message });
    try {
      console.info('[zcode-wc]', phase, message || '');
    } catch (_) {
      /* ignore */
    }
  }

  function reply(msg) {
    bc.postMessage(msg);
  }

  async function loadApi(cdnUrl) {
    emitStatus('downloading', 'Downloading WebContainer API (CDN)…');
    const url = cdnUrl || DEFAULT_CDN;
    const mod = await import(/* @vite-ignore */ url);
    const WC =
      mod.WebContainer ||
      (mod.default && mod.default.boot ? mod.default : null) ||
      (mod.default && mod.default.WebContainer) ||
      null;
    if (!WC || typeof WC.boot !== 'function') {
      throw new Error('WebContainer API failed to load from ' + url);
    }
    return WC;
  }

  async function ensureBoot(cdnUrl) {
    if (wc) {
      emitStatus('ready', 'WebContainer ready');
      return wc;
    }
    if (!bootPromise) {
      bootPromise = (async () => {
        const WC = await loadApi(cdnUrl);
        emitStatus(
          'booting',
          'Starting browser Node environment (first boot can take 10–30s)…',
        );
        const isolated = !!(globalThis.crossOriginIsolated);
        const coep = isolated ? 'require-corp' : 'none';
        wc = await WC.boot({ coep });
        emitStatus(
          'ready',
          isolated
            ? 'WebContainer ready (cross-origin isolated)'
            : 'WebContainer ready (COI off — some features may be limited)',
        );
      })().catch((err) => {
        bootPromise = null;
        const message = err && err.message ? err.message : String(err);
        emitStatus('error', message);
        throw err;
      });
    } else {
      emitStatus('booting', 'WebContainer boot already in progress…');
    }
    await bootPromise;
    return wc;
  }

  async function spawnShell(sessionId, cols, rows) {
    const container = await ensureBoot();
    emitStatus('mounting', 'Spawning interactive shell (jsh)…');
    const proc = await container.spawn('jsh', {
      terminal: { cols: cols || 80, rows: rows || 24 },
    });
    const writer = proc.input.getWriter();
    shells.set(sessionId, { proc, writer });

    // Pump output to extension
    (async () => {
      const reader = proc.output.getReader();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value) {
            reply({ type: 'output', sessionId, data: value });
          }
        }
      } catch (_) {
        /* closed */
      } finally {
        try {
          reader.releaseLock();
        } catch (_) {
          /* ignore */
        }
      }
      let code = 0;
      try {
        code = await proc.exit;
      } catch (_) {
        code = 1;
      }
      shells.delete(sessionId);
      reply({ type: 'exit', sessionId, code });
    })();

    emitStatus('ready', 'WebContainer shell ready');
  }

  async function mountTree(tree) {
    const container = await ensureBoot();
    emitStatus('mounting', 'Mounting workspace into WebContainer…');
    await container.mount(tree || {});
    emitStatus('ready', 'Workspace mounted');
  }

  bc.onmessage = (ev) => {
    const msg = ev.data || {};
    const id = msg.id;

    (async () => {
      try {
        switch (msg.type) {
          case 'ping':
            reply({
              type: 'pong',
              id,
              ready: !!wc,
              isolated: !!globalThis.crossOriginIsolated,
            });
            break;

          case 'prefetch':
          case 'boot':
            await ensureBoot(msg.cdnUrl);
            reply({ type: 'boot-result', id, ok: true, ready: true });
            break;

          case 'mount':
            await mountTree(msg.tree);
            reply({ type: 'mount-result', id, ok: true });
            break;

          case 'spawn-shell': {
            const sessionId = msg.sessionId || id || 'shell-' + Date.now();
            await spawnShell(sessionId, msg.cols, msg.rows);
            reply({ type: 'spawn-result', id, ok: true, sessionId });
            break;
          }

          case 'input': {
            const s = shells.get(msg.sessionId);
            if (s && msg.data != null) {
              await s.writer.write(String(msg.data));
            }
            break;
          }

          case 'resize': {
            const s = shells.get(msg.sessionId);
            if (s && s.proc.resize) {
              s.proc.resize({
                cols: msg.cols || 80,
                rows: msg.rows || 24,
              });
            }
            break;
          }

          case 'kill': {
            const s = shells.get(msg.sessionId);
            if (s) {
              try {
                s.proc.kill();
              } catch (_) {
                /* ignore */
              }
              try {
                await s.writer.close();
              } catch (_) {
                /* ignore */
              }
              shells.delete(msg.sessionId);
            }
            break;
          }

          default:
            break;
        }
      } catch (err) {
        const message = err && err.message ? err.message : String(err);
        emitStatus('error', message);
        if (msg.type === 'boot' || msg.type === 'prefetch') {
          reply({ type: 'boot-result', id, ok: false, error: message });
        } else if (msg.type === 'spawn-shell') {
          reply({ type: 'spawn-result', id, ok: false, error: message });
        } else if (msg.type === 'mount') {
          reply({ type: 'mount-result', id, ok: false, error: message });
        }
      }
    })();
  };

  // Early status so extensions know the bridge is alive
  emitStatus('idle', 'WebContainer bridge ready (main thread)');

  // Auto-prefetch shortly after paint so CDN download starts before the user opens a shell
  setTimeout(() => {
    ensureBoot().catch(() => {
      /* status already emitted */
    });
  }, 800);

  // Expose for debugging in DevTools
  globalThis.__zcodeWcBridge = {
    channel: CHANNEL,
    isReady: () => !!wc,
    boot: () => ensureBoot(),
  };
})();
