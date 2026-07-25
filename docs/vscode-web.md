# VS Code Web integration (M0)

ZCode’s **primary IDE UI is VS Code Web**, served at **`/`**.

The lightweight SPA at `/debug/` is a DEV-only dogfood surface for browser git/OPFS without loading the full workbench.

## Architecture

```text
/                  → apps/workbench (loads VS Code Web — product IDE)
/debug/            → apps/web (SPA: clone/edit/search — DEV only)
/vscode/*          → dist/vscode-web (static Code-OSS web compile)
/extensions/*      → extensions/zcode-*
/git-proxy/*       → stateless CORS bridge
/product.json      → dual-mode create() options (browser | remote)
```

Dual mode (workbench):

| Query | Behavior |
| --- | --- |
| `/` or `?mode=browser` | No `remoteAuthority`; folder `zcode-opfs:/workspace/…` |
| `/?mode=remote&authority=host:port` | Sets `remoteAuthority` + `vscode-remote` folder |

## Stage VS Code Web assets

### Dogfood (fast)

### Owned web + system extensions

Owned `dist/vscode-web` (esbuild) sets `_VSCODE_FILE_ROOT` to `/vscode/out/`. VS Code loads
**system** extension files from `/vscode/extensions/*` (path `vs/../../extensions`).

`scripts/fetch-vscode-web.sh` and `build-web.sh --package` stage
`vendor/vscode/.build/web/extensions` → `dist/vscode-web/extensions`.

Without that folder you get console errors like:

- `ExtensionResourceLoaderService.readExtensionResource … Not Found`
- `Activating extension 'vscode.typescript-language-features' failed: Not Found`
- 404 on `/vscode/node_modules/...` (dogfood AMD only; owned ESM usually ignores these)

**Harmless noise in pure browser mode:** `file:///.copilot`, `file:///.claude`, `file:///.agents`
— VS Code agent/prompt discovery using the HTML File System API. No local disk handle is
registered; safe to ignore.

Product (ZCode) extensions stay at **`/extensions/zcode-*`** (separate from system
`/vscode/extensions`).

Third-party npm package packaging Microsoft’s web compile (not our pin; labeled dogfood):

```bash
./scripts/fetch-vscode-web.sh
# → dist/vscode-web
```

### Owned build (GA path / M0d)

Use **Node 24** (`vendor/vscode/.nvmrc`). See [m0d-owned-web-spike.md](./m0d-owned-web-spike.md).

```bash
./scripts/build-web.sh --package   # gulp vscode-web → dist/vscode-web
./scripts/fetch-vscode-web.sh      # prefers owned tree when present
```

## Build & run

```bash
pnpm --filter @zcode/workbench build
pnpm --filter @zcode/web build
pnpm --filter @zcode/cli build
./scripts/fetch-vscode-web.sh

node apps/cli/dist/cli.js web --dir apps/web/dist --port 5000
```

- http://127.0.0.1:5000/ — **VS Code Web**
- http://127.0.0.1:5000/ — SPA workspace tools

Or: `pnpm dev:ide`

## E2E

```bash
pnpm e2e:playwright
```

Covers same-origin routes, SPA clone (Hello-World), and `/product.json?workspace=` handoff.

## Product branding

[`product/product.json`](../product/product.json) — Open VSX gallery, ZCode names.

## Virtual workspace (browser mode)

`zcode-browser-fs` registers the `zcode-opfs` scheme and seeds `/workspace/default` with sample files.

`/product.json` points `folderUri` at that folder and loads the extension via:

```json
"additionalBuiltinExtensions": [
  { "scheme": "http", "authority": "<host>", "path": "/extensions/zcode-browser-fs" }
]
```

Bootstrap injects `location.host` so extension URIs are absolute same-origin.

## Status

| Piece | Status |
| --- | --- |
| Load VS Code Web workbench | ✅ `/vscode` + `/` |
| ZCode product.json | ✅ |
| Dual-mode product payload | ✅ |
| Built-in extensions served | ✅ `/vscode/extensions/*` (owned web) + `/extensions/zcode-*` (product) |
| `zcode-opfs` FileSystemProvider | ✅ seeded sample workspace |
| Owned 1.129 web compile in CI | ⏳ scripts ready (`build-web.sh --package`); dogfood until staged |
| Browser SCM (`zcode-git`) | ✅ status / commit / push over IDB |
| REH cookie proxy (R3b) | ✅ when `dist/server` artifact + `zcode serve` |

**Custom SPA (`/debug/`) is tools/dogfood (DEV only).** **Primary IDE is `/`.**
