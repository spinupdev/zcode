# WebContainers Node engine

## Overview

`zcode-runtime-node` boots a [WebContainer](https://webcontainers.io/) for **real Node** in the browser:

1. **Multi-file mount** from the open workspace (OPFS / folder)  
2. **Optional `npm install`** when `package.json` is present  
3. **`node <file>`** for Run File  
4. Commands: **npm install**, **npm run…**, **Mount Preview**  
5. **Worker fallback** if WebContainer cannot boot  

## Settings

| Setting | Default | Meaning |
| --- | --- | --- |
| `zcode.execution.nodeEngine` | `auto` | `auto` · `webcontainer` · `worker` |
| `zcode.execution.webcontainerCdnUrl` | jsDelivr `@webcontainer/api@1.6.1` | ESM CDN |
| `zcode.execution.webcontainerAutoNpmInstall` | `true` | Run `npm install` once per folder session before `node` |

## Limits (mount)

| Limit | Value |
| --- | --- |
| Max files | 400 |
| Max total bytes | 8 MiB |
| Max single file | 512 KiB |
| Skipped dirs | `node_modules`, `.git`, `dist`, `out`, … |
| Binary extensions | skipped |

## Cross-origin isolation

Prefer SharedArrayBuffer:

```bash
ZCODE_COI=1 zcode web …
# or
ZCODE_CROSS_ORIGIN_ISOLATION=1 zcode serve …
```

Without COI, the extension still tries `boot({ coep: 'none' })` and falls back to the Worker.

## Interactive shell (Pseudoterminal)

Browser mode uses VS Code **extension terminals**, not REH `node-pty`:

1. Mount workspace tree into the shared WebContainer session  
2. Spawn **`jsh`** with `terminal: { cols, rows }`  
3. Bridge `process.input` / `process.output` ↔ `vscode.Pseudoterminal`  

| Entry | Action |
| --- | --- |
| **ZCode: Open WebContainer Shell** | Open integrated terminal on `jsh` |
| **ZCode: Open Browser Shell** | Core router (Node → WC, Python → Pyodide) |
| Profile **WebContainer Shell** | Terminal `+` menu / default profile in browser product |

Requires WebContainers (not worker fallback). Prefer `ZCODE_COI=1` for SharedArrayBuffer.

### Startup feedback

After the workbench loads (browser mode only):

1. **Status bar** — `Shell: downloading…` → `starting…` → `mounting…` → `ready` (or `offline`)  
2. **Progress** — With auto-open (default): feedback lives in the Terminal panel + status bar. With auto-open off + prefetch on: Notification on first cold boot, then Window progress  
3. **Auto-open shell** (default) — Terminal panel opens immediately with download logs so it is never empty  
4. **Output** channel **ZCode Shell** — phase log for debugging  

| Setting | Default | Meaning |
| --- | --- | --- |
| `zcode.execution.prefetchWebContainer` | `true` | Boot WebContainer in the background after load |
| `zcode.execution.autoOpenShell` | `true` | Open WebContainer terminal on startup |
| `zcode.execution.prefetchPyodide` | `true` | Warm Pyodide WASM (status bar only; no auto REPL) |

## Commands

| Command | Action |
| --- | --- |
| **ZCode: Run File** | Mount workspace → npm install (if needed) → `node <relpath>` |
| **ZCode: Open WebContainer Shell** | Interactive `jsh` Pseudoterminal |
| **ZCode: npm install (WebContainer)** | Mount + forced `npm install` |
| **ZCode: npm run… (WebContainer)** | Mount + install + `npm run <script>` |
| **ZCode: WebContainer Mount Preview** | Count files that would be mounted |

## License

`@webcontainer/api` is subject to StackBlitz / WebContainers terms. Confirm suitability for your distribution before production SaaS use.
