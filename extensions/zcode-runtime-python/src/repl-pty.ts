/**
 * VS Code Pseudoterminal bridged to a Pyodide interactive REPL.
 *
 * Line-buffered input with multi-line support via Python's `codeop.compile_command`.
 */
import * as vscode from 'vscode';

export interface PyodideReplHost {
  /** Ensure Pyodide is loaded and return a runner. */
  ensure(): Promise<PyodideReplEngine>;
}

export interface PyodideReplEngine {
  /** Run Python source; stdout/stderr go through the provided writers. */
  run(code: string, io: { stdout: (s: string) => void; stderr: (s: string) => void }): Promise<void>;
  /**
   * Returns:
   * - `'incomplete'` if more lines are needed
   * - `'complete'` if the block is ready to execute
   * - `'error'` if the fragment has a syntax error (still "complete" enough to fail on run)
   */
  checkComplete(source: string): Promise<'incomplete' | 'complete' | 'error'>;
}

const PROMPT = '>>> ';
const CONT = '... ';

function toCrlf(s: string): string {
  return s.replace(/\r?\n/g, '\r\n');
}

/**
 * Create a Pseudoterminal that drives a Pyodide REPL.
 */
export function createPyodideReplPty(host: PyodideReplHost): {
  pty: vscode.Pseudoterminal;
  onDidClose: vscode.Event<number | void>;
} {
  const writeEmitter = new vscode.EventEmitter<string>();
  const closeEmitter = new vscode.EventEmitter<number | void>();

  let engine: PyodideReplEngine | undefined;
  let closed = false;
  let lineBuf = '';
  let block: string[] = [];
  let busy = false;

  const write = (s: string) => writeEmitter.fire(toCrlf(s));
  const prompt = () => write(block.length ? CONT : PROMPT);

  const resetBlock = () => {
    block = [];
    lineBuf = '';
  };

  const executeBlock = async (source: string) => {
    if (!engine) return;
    busy = true;
    try {
      await engine.run(source, {
        stdout: (s) => write(s.endsWith('\n') ? s : `${s}\n`),
        stderr: (s) => write(`\x1b[31m${s.endsWith('\n') ? s : `${s}\n`}\x1b[0m`),
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      write(`\x1b[31m${msg}\x1b[0m\n`);
    } finally {
      busy = false;
      resetBlock();
      if (!closed) prompt();
    }
  };

  const submitLine = async (line: string) => {
    if (!engine || closed) return;

    // Empty line with no continuation → re-prompt
    if (line === '' && block.length === 0) {
      prompt();
      return;
    }

    block.push(line);
    const source = block.join('\n');

    // Bare Enter after a complete statement on prior line already handled via compile
    try {
      const status = await engine.checkComplete(source);
      if (status === 'incomplete') {
        prompt();
        return;
      }
      // complete or error — try to run (error surfaces traceback)
      await executeBlock(source);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      write(`\x1b[31m${msg}\x1b[0m\n`);
      resetBlock();
      prompt();
    }
  };

  const pty: vscode.Pseudoterminal = {
    onDidWrite: writeEmitter.event,
    onDidClose: closeEmitter.event,

    open(): void {
      void (async () => {
        try {
          write('\x1b[2m[zcode] Preparing Pyodide (downloads WASM on first run)…\x1b[0m\r\n');
          engine = await host.ensure();
          write('Python (Pyodide) — browser REPL\r\n');
          write('Exit: Ctrl+D · Clear: Ctrl+L · Multi-line: continue until complete\r\n\r\n');
          prompt();
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          write(`\x1b[31m[zcode] Pyodide failed: ${msg}\x1b[0m\r\n`);
          write('\x1b[2mCheck network access to the Pyodide CDN (zcode.execution.pyodideIndexUrl).\x1b[0m\r\n');
          closed = true;
          closeEmitter.fire(1);
        }
      })();
    },

    close(): void {
      closed = true;
      engine = undefined;
      resetBlock();
    },

    handleInput(data: string): void {
      if (closed || busy) return;

      for (const ch of data) {
        // Ctrl+C — cancel current block
        if (ch === '\x03') {
          write('^C\r\n');
          resetBlock();
          prompt();
          continue;
        }
        // Ctrl+D — exit when buffer empty
        if (ch === '\x04') {
          if (lineBuf.length === 0 && block.length === 0) {
            write('exit\r\n');
            closed = true;
            closeEmitter.fire(0);
            return;
          }
          continue;
        }
        // Ctrl+L — clear screen
        if (ch === '\x0c') {
          write('\x1b[2J\x1b[H');
          prompt();
          write(lineBuf);
          continue;
        }
        // Enter
        if (ch === '\r' || ch === '\n') {
          write('\r\n');
          const line = lineBuf;
          lineBuf = '';
          void submitLine(line);
          continue;
        }
        // Backspace
        if (ch === '\x7f' || ch === '\b') {
          if (lineBuf.length > 0) {
            lineBuf = lineBuf.slice(0, -1);
            write('\b \b');
          }
          continue;
        }
        // Ignore other control chars
        if (ch < ' ' && ch !== '\t') continue;

        lineBuf += ch;
        write(ch);
      }
    },
  };

  return { pty, onDidClose: closeEmitter.event };
}

export function openPyodideReplTerminal(
  host: PyodideReplHost,
  name = 'Python (Pyodide)',
): vscode.Terminal {
  const { pty } = createPyodideReplPty(host);
  const term = vscode.window.createTerminal({
    name,
    pty,
    iconPath: new vscode.ThemeIcon('python'),
  });
  term.show(true);
  return term;
}
