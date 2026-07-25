# zcode-runtime-node

Run **JavaScript / TypeScript** in the browser (no REH required).

| Engine | Setting | Notes |
| --- | --- | --- |
| **WebContainers** | `webcontainer` or `auto` | Multi-file OPFS mount, `npm install`, `node <file>`, `npm run` |
| **Worker** | `worker` or auto fallback | Lightweight `console.log` only |

Commands: **Run File** · **npm install (WebContainer)** · **npm run…** · **Mount Preview**

```bash
ZCODE_COI=1 node apps/cli/dist/cli.js web --dir apps/web/dist --port 5000 --spa-debug
```

See [docs/webcontainers-node.md](../../docs/webcontainers-node.md).
