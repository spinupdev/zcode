# zcode-runtime-node

Run **JavaScript / TypeScript** in the browser (no REH required).

| Engine | Setting | Notes |
| --- | --- | --- |
| **WebContainers** | `webcontainer` or `auto` | Multi-file OPFS mount, `npm install`, `node <file>`, `npm run`, **interactive `jsh`** |
| **Worker** | `worker` or auto fallback | Lightweight `console.log` only (no shell) |

## Terminal (Pseudoterminal)

| Entry | What |
| --- | --- |
| **ZCode: Open WebContainer Shell** | Integrated terminal → WebContainers `jsh` |
| **ZCode: Open Browser Shell** (core) | Language-aware: WebContainer or Pyodide |
| Terminal profile **WebContainer Shell** | `+` dropdown / default profile in browser mode |

The shell mounts the open workspace (same limits as Run File) then spawns `jsh` with xterm I/O via `vscode.Pseudoterminal`.

## Commands

**Run File** · **Open WebContainer Shell** · **npm install** · **npm run…** · **Mount Preview**

```bash
ZCODE_COI=1 node apps/cli/dist/cli.js web --dir apps/web/dist --port 5000 --spa-debug
```

See [docs/webcontainers-node.md](../../docs/webcontainers-node.md).
