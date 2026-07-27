# VS Code Web integration (M0)

ZCode’s **primary IDE UI is VS Code Web**, served at **`/`**.

The lightweight SPA at `/debug/` is a DEV-only dogfood surface for browser git/OPFS without loading the full workbench.

## Architecture

```text
/                  → apps/workbench (loads VS Code Web — product IDE)
/debug/            → apps/web (SPA: clone/edit/search — DEV only)
/vscode/*          → dist/vscode-web (static Code-OSS web compile)
/extensions/*      → extensions/zcode-* + marketplace themes (vscode-icons, github-vscode-theme)
/git-proxy/*       → stateless CORS bridge
/product.json      → dual-mode create() options (browser | remote)
```

## Walkthroughs / webviews

VS Code walkthrough media (theme picker, SVG steps) loads in an **iframe**. By default
upstream product templates point that iframe at **Microsoft’s `vscode-cdn.net`**, which
refuses to frame on non-Microsoft origins and shows **“This content is blocked.”**

ZCode always sets same-origin:

| Create option | Value |
| --- | --- |
| `webviewEndpoint` | `{origin}/vscode/out/vs/workbench/contrib/webview/browser/pre` |
| `productConfiguration.webviewContentExternalBaseUrlTemplate` | same path + trailing `/` |

Assets live under `dist/vscode-web/out/vs/workbench/contrib/webview/browser/pre/`
(`index.html`, service-worker). Bootstrap rewrites absolute URLs from `location.origin`.

### ZCode branding in walkthrough copy

- NLS post-process: `scripts/brand-vscode-nls.sh` (runs from `fetch-vscode-web.sh` / `build-web.sh --package`)
- Source patch: `patches/0003-brand-walkthrough-zcode.patch` (Getting Started titles → **ZCode**)

## Default theme & icons

Workbench product defaults (see `@zcode/shell` `configurationDefaultsForMode`):

| Setting | Default |
| --- | --- |
| `workbench.iconTheme` | `vscode-icons` ([vscode-icons](https://marketplace.visualstudio.com/items?itemName=vscode-icons-team.vscode-icons)) |
| `workbench.preferredDarkColorTheme` | `GitHub Dark Default` |
| `workbench.preferredLightColorTheme` | `GitHub Light Default` |
| `window.autoDetectColorScheme` | `true` (follows browser/OS light·dark) |

Stage the marketplace extensions once:

```bash
pnpm fetch:themes   # scripts/fetch-theme-extensions.sh → extensions/vscode-icons + github-vscode-theme
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

`zcode-browser-fs` registers the `zcode-opfs` scheme. Startup opens **empty**
`/workspace/default` (no hello.js / seed samples). Optional samples:
**ZCode: Seed Sample Files** in the command palette.

`/product.json` points `folderUri` at that folder and loads:

```json
"additionalBuiltinExtensions": [
  { "scheme": "http", "authority": "<host>", "path": "/extensions/zcode-browser-fs" },
  { "scheme": "http", "authority": "<host>", "path": "/vscode/extensions/javascript" },
  { "scheme": "http", "authority": "<host>", "path": "/vscode/extensions/python" }
]
```

Language/theme packs (TextMate grammars for 40+ languages) are listed in
[`product/language-extensions.json`](../product/language-extensions.json) and served from
`/vscode/extensions/*`. Bootstrap injects `location.host` so extension URIs are absolute same-origin.

Default theme: **GitHub Dark Default** + **vscode-icons** (from Open VSX via
`scripts/fetch-theme-extensions.sh`). Bootstrap falls back to Default Dark Modern /
vs-seti only if those extensions fail to load.

Extra language packs (same script + `product/extra-language-extensions.json`): HCL,
Terraform, Nix, Kotlin, Scala, Elixir, Haskell, Solidity, Zig, Fortran, COBOL,
Pascal/Delphi, ABAP, SystemVerilog, VHDL, Gleam, Crystal, Erlang, Assembly, MATLAB,
Scheme, Prolog, GDScript, OCaml, SAS, Common Lisp — under `/extensions/<name>`.

Built-in packs under `/vscode/extensions` already cover Python, TypeScript, JavaScript,
Java, C#/C++/C, Go, Rust, PHP, SQL, Swift, Ruby, Dart, R, Shell, PowerShell, Objective-C,
Lua, Perl, Clojure, Groovy, Julia, F#, VB, and more.

### Syntax highlighting (TextMate)

Owned web loads the tokenizer from:

```text
/vscode/node_modules/vscode-oniguruma/release/onig.wasm
/vscode/node_modules/vscode-textmate/release/main.js
```

Stage with:

```bash
./scripts/stage-vscode-web-node-modules.sh   # or: ./scripts/fetch-vscode-web.sh
```

If `onig.wasm` 404s, languages/icons may still work but the editor stays **monochrome**.
Server logs `oniguruma WASM OK` when the file is present.

## Status

| Piece | Status |
| --- | --- |
| Load VS Code Web workbench | ✅ `/vscode` + `/` |
| ZCode product.json | ✅ |
| Dual-mode product payload | ✅ |
| Built-in extensions served | ✅ `/vscode/extensions/*` (owned web) + `/extensions/zcode-*` (product) |
| `zcode-opfs` FileSystemProvider | ✅ empty default workspace; optional seed command |
| TextMate language packs (40+) | ✅ `/vscode/extensions` + additionalBuiltinExtensions |
| Owned 1.129 web compile in CI | ⏳ scripts ready (`build-web.sh --package`); dogfood until staged |
| Browser SCM (`zcode-git`) | ✅ status / commit / push over IDB |
| REH cookie proxy (R3b) | ✅ when `dist/server` artifact + `zcode serve` |

**Custom SPA (`/debug/`) is tools/dogfood (DEV only).** **Primary IDE is `/`.**
