# WebContainers Node engine

## Overview

`zcode-runtime-node` can boot a [WebContainer](https://webcontainers.io/) for **real Node** in the browser, with automatic fallback to a simple Worker.

## Settings

| Setting | Default | Meaning |
| --- | --- | --- |
| `zcode.execution.nodeEngine` | `auto` | `auto` · `webcontainer` · `worker` |
| `zcode.execution.webcontainerCdnUrl` | jsDelivr `@webcontainer/api@1.6.1` | ESM CDN URL |

## Cross-origin isolation

WebContainers prefer `SharedArrayBuffer` → cross-origin isolation:

```bash
ZCODE_COI=1 zcode web …
# or
ZCODE_CROSS_ORIGIN_ISOLATION=1 zcode serve …
```

Sets:

- `Cross-Origin-Opener-Policy: same-origin`
- `Cross-Origin-Embedder-Policy: credentialless`

If COI is off, the extension still tries `boot({ coep: 'none' })` and falls back to the Worker on failure.

## License

`@webcontainer/api` is subject to StackBlitz / WebContainers terms. Confirm suitability for your distribution before production SaaS use.
