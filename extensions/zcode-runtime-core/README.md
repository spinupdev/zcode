# zcode-runtime-core

Pluggable **execution backend** registry for server-agnostic ZCode (WB0).

- Commands: **Run File**, **Run Selection**, **Select Execution Backend**, **Open Browser Shell**
- Status bar shows active backend
- Sibling extensions register via `globalThis.zcodeRuntime.register(...)`
- **Open Browser Shell** routes to WebContainer `jsh` or Pyodide REPL by language / backend

See [docs/plan-server-agnostic-ide.md](../../docs/plan-server-agnostic-ide.md) and ADR 0001.
