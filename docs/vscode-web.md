# VS Code Web integration (M0)

ZCode’s **primary IDE UI is VS Code Web**, served at **`/ide/`**.

The lightweight SPA at `/` remains a dogfood surface for browser git/OPFS without loading the full workbench.

## Architecture

```text
/                  → apps/web (SPA: clone/edit/search)
/ide/              → apps/workbench (loads VS Code Web)
/vscode/*          → dist/vscode-web (static Code-OSS web compile)
/extensions/*      → extensions/zcode-*
/git-proxy/*       → stateless CORS bridge
/ide/product.json  → dual-mode create() options (browser | remote)
```

Dual mode (workbench):

| Query | Behavior |
| --- | --- |
| `/ide/` or `?mode=browser` | No `remoteAuthority`; folder `zcode-opfs:/workspace/…` |
| `/ide/?mode=remote&authority=host:port` | Sets `remoteAuthority` + `vscode-remote` folder |

## Stage VS Code Web assets

### Dogfood (fast)

Third-party npm package packaging Microsoft’s web compile (not our pin; labeled dogfood):

```bash
./scripts/fetch-vscode-web.sh
# → dist/vscode-web
```

### Owned build (GA path)

From `vendor/vscode` (see [building-vscode.md](./building-vscode.md)):

```bash
# After npm install + gulp in vendor/vscode:
#   npm run gulp compile-web
#   npm run gulp vscode-web   # or esbuild-vscode-web + package
./scripts/fetch-vscode-web.sh   # prefers owned .build/vscode-web if present
```

## Build & run

```bash
pnpm --filter @zcode/workbench build
pnpm --filter @zcode/web build
pnpm --filter @zcode/cli build
./scripts/fetch-vscode-web.sh

node apps/cli/dist/cli.js web --dir apps/web/dist --port 5000
```

- http://127.0.0.1:5000/ide/ — **VS Code Web**
- http://127.0.0.1:5000/ — SPA workspace tools

Or: `pnpm dev:ide`

## E2E

```bash
pnpm e2e:playwright
```

Covers same-origin routes, SPA clone (Hello-World), and `/ide/product.json?workspace=` handoff.

## Product branding

[`product/product.json`](../product/product.json) — Open VSX gallery, ZCode names.

## Virtual workspace (browser mode)

`zcode-browser-fs` registers the `zcode-opfs` scheme and seeds `/workspace/default` with sample files.

`/ide/product.json` points `folderUri` at that folder and loads the extension via:

```json
"additionalBuiltinExtensions": [
  { "scheme": "http", "authority": "<host>", "path": "/extensions/zcode-browser-fs" }
]
```

Bootstrap injects `location.host` so extension URIs are absolute same-origin.

## Status

| Piece | Status |
| --- | --- |
| Load VS Code Web workbench | ✅ `/vscode` + `/ide` |
| ZCode product.json | ✅ |
| Dual-mode product payload | ✅ |
| Built-in extensions served | ✅ `/extensions/*` |
| `zcode-opfs` FileSystemProvider | ✅ seeded sample workspace |
| Owned 1.129 web compile in CI | ⏳ dogfood npm for local |

**Custom SPA (`/`) is tools/dogfood.** **Primary IDE is `/ide/`.**
