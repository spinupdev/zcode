/**
 * VS Code Pseudoterminal backed by main-thread WebContainer bridge (jsh).
 */
import * as vscode from 'vscode';
import { getWcBridge, type WcBridgeClient } from './wc-bridge-client.js';
import {
  buildFileSystemTree,
  workspaceFolderFor,
} from './fs-tree.js';

/**
 * Create a Pseudoterminal that bridges xterm ↔ WebContainer process I/O via BroadcastChannel.
 */
export function createWebContainerShellPty(bridge?: WcBridgeClient): {
  pty: vscode.Pseudoterminal;
  onDidClose: vscode.Event<number | void>;
} {
  const client = bridge ?? getWcBridge();
  const writeEmitter = new vscode.EventEmitter<string>();
  const closeEmitter = new vscode.EventEmitter<number | void>();

  let session: {
    write: (data: string) => void;
    resize: (c: number, r: number) => void;
    kill: () => void;
  } | null = null;
  let closed = false;

  const toCrlf = (s: string) => s.replace(/\r?\n/g, '\r\n');
  const info = (s: string) => writeEmitter.fire(`\x1b[2m[zcode] ${s}\x1b[0m\r\n`);
  const errLine = (s: string) => writeEmitter.fire(`\x1b[31m[zcode] ${s}\x1b[0m\r\n`);

  const pty: vscode.Pseudoterminal = {
    onDidWrite: writeEmitter.event,
    onDidClose: closeEmitter.event,

    open(initialDimensions?: vscode.TerminalDimensions): void {
      const cols = initialDimensions?.columns ?? 80;
      const rows = initialDimensions?.rows ?? 24;

      void (async () => {
        try {
          info('Connecting to WebContainer bridge (main thread)…');
          client.connect();

          const unsub = client.onStatus((s) => {
            if (s.message) info(`${s.phase}: ${s.message}`);
          });

          try {
            // Ping with short timeout for clear error
            try {
              const pong = await client.ping(4000);
              info(
                pong.ready
                  ? 'Bridge OK — runtime already booted'
                  : `Bridge OK — isolated=${pong.isolated} · booting runtime…`,
              );
            } catch {
              errLine(
                'No response from wc-bridge.js. Rebuild workbench (`pnpm --filter @zcode/workbench build`) and hard-refresh.',
              );
              throw new Error('WebContainer bridge not loaded on the workbench page');
            }

            info('Downloading / booting WebContainer (first run can take 10–30s)…');
            await client.boot();

            // Best-effort workspace mount from extension FS (works in worker)
            const folder =
              workspaceFolderFor(vscode.window.activeTextEditor?.document.uri) ??
              vscode.workspace.workspaceFolders?.[0];
            if (folder) {
              try {
                info('Reading workspace for mount…');
                const built = await buildFileSystemTree(folder.uri);
                info(
                  `Mounting ${built.fileCount} file(s) (${Math.round(built.bytes / 1024)} KiB)…`,
                );
                await client.mount(built.tree as unknown as Record<string, unknown>);
              } catch (mountErr) {
                const m = mountErr instanceof Error ? mountErr.message : String(mountErr);
                info(`Workspace mount skipped: ${m}`);
              }
            } else {
              info('No workspace folder — empty container FS');
            }

            info('Spawning jsh…');
            session = await client.spawnShell({
              cols,
              rows,
              onOutput: (data) => {
                if (!closed) writeEmitter.fire(data);
              },
              onExit: (code) => {
                if (!closed) {
                  writeEmitter.fire(
                    `\r\n\x1b[2m[zcode] shell exited (${code})\x1b[0m\r\n`,
                  );
                  closed = true;
                  closeEmitter.fire(code);
                }
              },
            });
            info('Shell ready.');
          } finally {
            unsub.dispose();
          }
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          errLine(`WebContainer shell failed: ${msg}`);
          info('Tips: pnpm dev (ZCODE_COI=1) · hard-refresh · check Output “ZCode Shell”');
          closed = true;
          closeEmitter.fire(1);
        }
      })();
    },

    close(): void {
      closed = true;
      try {
        session?.kill();
      } catch {
        /* ignore */
      }
      session = null;
    },

    handleInput(data: string): void {
      if (!session || closed) return;
      try {
        session.write(data);
      } catch {
        /* ignore */
      }
    },

    setDimensions(dimensions: vscode.TerminalDimensions): void {
      try {
        session?.resize(dimensions.columns, dimensions.rows);
      } catch {
        /* ignore */
      }
    },
  };

  return { pty, onDidClose: closeEmitter.event };
}

export function openWebContainerTerminal(
  name = 'WebContainer',
  bridge?: WcBridgeClient,
): vscode.Terminal {
  const { pty } = createWebContainerShellPty(bridge);
  const term = vscode.window.createTerminal({
    name,
    pty,
    iconPath: new vscode.ThemeIcon('terminal-bash'),
  });
  term.show(true);
  return term;
}
