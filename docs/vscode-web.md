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

## Product branding

[`product/product.json`](../product/product.json) — Open VSX gallery, ZCode names.

## Status

| Piece | Status |
| --- | --- |
| Load VS Code Web workbench | ✅ via staged `/vscode` + `/ide` |
| ZCode product.json | ✅ |
| Dual-mode product payload | ✅ query + `/ide/product.json` |
| Built-in extension packages served | ✅ `/extensions/*` |
| Extension fully wired to workbench FS | ⏳ needs workbench + provider activation smoke |
| Owned 1.129 web compile in CI | ⏳ long-running; dogfood npm for local |

**Custom SPA is not the product editor** — it coexists until extensions + owned build are solid.
