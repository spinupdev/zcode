# zcode-runtime-python

Run **Python in the browser** with [Pyodide](https://pyodide.org/) — no remote server (WB1).

- Registers backend id `browser-python` with `zcode-runtime-core`
- First run downloads WASM from `zcode.execution.pyodideIndexUrl` (jsDelivr by default)
- **ZCode: Run File** on a `.py` editor
- **ZCode: Open Python REPL (Pyodide)** — interactive terminal via `vscode.Pseudoterminal`
- Terminal profile **Python (Pyodide)** in the `+` dropdown

REPL notes: multi-line via `codeop`; Ctrl+C cancel block; Ctrl+D exit; Ctrl+L clear. Same Pyodide instance as Run File.

Limits: no arbitrary native wheels; scientific stack partial via micropip (future).
