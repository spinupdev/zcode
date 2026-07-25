# zcode-runtime-node

Run **JavaScript / TypeScript** in the browser (no REH required).

| Engine | Setting | Notes |
| --- | --- | --- |
| **WebContainers** | `zcode.execution.nodeEngine`: `webcontainer` or `auto` | Real Node (npm-capable). Loads `@webcontainer/api` from CDN. Best with `ZCODE_COI=1` (COOP/COEP) for SharedArrayBuffer. |
| **Worker** | `worker` or auto fallback | Lightweight `console.log` runner; not full Node |

```json
"zcode.execution.nodeEngine": "auto"
```

Host tip for WebContainers:

```bash
ZCODE_COI=1 node apps/cli/dist/cli.js web --dir apps/web/dist --port 5000 --spa-debug
```
