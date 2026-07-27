/**
 * VS Code Pseudoterminal backed by WebContainers `jsh` (interactive shell).
 */
import * as vscode from 'vscode';

export interface WcProcess {
  exit: Promise<number>;
  input: WritableStream<string>;
  output: ReadableStream<string>;
  kill(): void;
  resize(dimensions: { cols: number; rows: number }): void;
}

export interface WcShellHost {
  /** Boot container if needed, mount workspace when possible, spawn jsh with PTY. */
  spawnInteractiveShell(opts: {
    cols: number;
    rows: number;
    onLog: (chunk: string) => void;
  }): Promise<WcProcess>;
  /** True if container already booted (skip long download messages). */
  isReady?(): boolean;
}

/**
 * Create a Pseudoterminal that bridges xterm ↔ WebContainer process I/O.
 */
export function createWebContainerShellPty(host: WcShellHost): {
  pty: vscode.Pseudoterminal;
  onDidClose: vscode.Event<number | void>;
} {
  const writeEmitter = new vscode.EventEmitter<string>();
  const closeEmitter = new vscode.EventEmitter<number | void>();

  let proc: WcProcess | undefined;
  let inputWriter: WritableStreamDefaultWriter<string> | undefined;
  let closed = false;
  let outputPump: Promise<void> | undefined;

  const toCrlf = (s: string) => s.replace(/\r?\n/g, '\r\n');
  const info = (s: string) => writeEmitter.fire(`\x1b[2m[zcode] ${s}\x1b[0m\r\n`);

  const pty: vscode.Pseudoterminal = {
    onDidWrite: writeEmitter.event,
    onDidClose: closeEmitter.event,

    open(initialDimensions?: vscode.TerminalDimensions): void {
      const cols = initialDimensions?.columns ?? 80;
      const rows = initialDimensions?.rows ?? 24;

      void (async () => {
        try {
          if (host.isReady?.()) {
            info('WebContainer ready · opening shell…');
          } else {
            info('Preparing browser shell (first run downloads runtime artifacts)…');
            info('This can take 10–30s on a cold start.');
          }
          proc = await host.spawnInteractiveShell({
            cols,
            rows,
            onLog: (chunk) => writeEmitter.fire(toCrlf(chunk)),
          });
          inputWriter = proc.input.getWriter();

          outputPump = (async () => {
            const reader = proc!.output.getReader();
            try {
              while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                if (value) writeEmitter.fire(value);
              }
            } catch {
              /* stream closed */
            } finally {
              try {
                reader.releaseLock();
              } catch {
                /* ignore */
              }
            }
            if (!closed) {
              let code = 0;
              try {
                code = await proc!.exit;
              } catch {
                code = 1;
              }
              writeEmitter.fire(
                `\r\n\x1b[2m[zcode] shell exited (${code})\x1b[0m\r\n`,
              );
              closed = true;
              closeEmitter.fire(code);
            }
          })();
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          writeEmitter.fire(`\r\n\x1b[31m[zcode] WebContainer shell failed: ${msg}\x1b[0m\r\n`);
          writeEmitter.fire(
            '\x1b[2mTip: run with ZCODE_COI=1 (pnpm dev) for SharedArrayBuffer, or check network / CDN.\x1b[0m\r\n',
          );
          closed = true;
          closeEmitter.fire(1);
        }
      })();
    },

    close(): void {
      closed = true;
      try {
        proc?.kill();
      } catch {
        /* ignore */
      }
      try {
        void inputWriter?.close();
      } catch {
        /* ignore */
      }
      try {
        inputWriter?.releaseLock();
      } catch {
        /* ignore */
      }
      inputWriter = undefined;
      proc = undefined;
      void outputPump;
    },

    handleInput(data: string): void {
      if (!inputWriter || closed) return;
      void inputWriter.write(data).catch(() => {
        /* ignore broken pipe */
      });
    },

    setDimensions(dimensions: vscode.TerminalDimensions): void {
      try {
        proc?.resize({ cols: dimensions.columns, rows: dimensions.rows });
      } catch {
        /* ignore */
      }
    },
  };

  return { pty, onDidClose: closeEmitter.event };
}

export function openWebContainerTerminal(
  host: WcShellHost,
  name = 'WebContainer',
): vscode.Terminal {
  const { pty } = createWebContainerShellPty(host);
  const term = vscode.window.createTerminal({
    name,
    pty,
    iconPath: new vscode.ThemeIcon('terminal-bash'),
  });
  term.show(true);
  return term;
}
