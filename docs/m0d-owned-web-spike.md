# M0d — Owned VS Code Web build (pin 1.129.0)

Status: **owned package path works** via `gulp vscode-web-ci` (esbuild). Dogfood AMD remains a fallback when only `fetch-vscode-web.sh` has been run.

## Goal

Replace dogfood `vscode-web@1.91.1` with an **owned** static tree from `vendor/vscode@1.129.0` at `dist/vscode-web`.

## Success criteria

| Check | Result (2026-07-17 agent session) |
| --- | --- |
| `dist/vscode-web/.zcode-vscode-web.json` `"source":"owned"` | **yes** |
| Entry `out/vs/workbench/workbench.web.main.internal.js` | **yes** (esbuild; no AMD `loader.js`) |
| Workbench dual bootstrap (owned ESM + dogfood AMD) | **yes** (`apps/workbench` bootstrap) |
| `/` + `/vscode/...internal.js` HTTP 200 | **yes** (smoke) |

## Prerequisites

| Item | Requirement |
| --- | --- |
| Node | **24.x** (`vendor/vscode/.nvmrc`) |
| Disk free | **≥ 30 GB** recommended |
| `GITHUB_TOKEN` | Recommended for `@vscode/ripgrep` postinstall (anonymous **403** common) |

```bash
export PATH="/path/to/node24/bin:$PATH"   # or nvm use 24
export GITHUB_TOKEN="$(gh auth token)"
./scripts/build-web.sh --check
./scripts/build-web.sh --package         # prefers gulp vscode-web-ci (~1 min after deps)
```

## Package strategy (1.129)

Full `gulp vscode-web` runs **compile-build-with-mangling** and often fails typecheck (mangler + tests + copilot types).

Preferred path (what `build-web.sh --package` uses first):

1. `gulp vscode-web-ci` — extensions + **esbuild-vscode-web** + product package (~45s warm)
2. Fallback: `compile-build-without-mangling` + `vscode-web-ci`
3. Fallback: full `gulp vscode-web` (mangler)

Staging normalizes layouts so the host always sees:

```text
dist/vscode-web/out/vs/workbench/workbench.web.main.internal.js
```

## Workbench load paths

| Layout | Detect | Load |
| --- | --- | --- |
| Owned esbuild | HEAD `…/workbench.web.main.internal.js` | `import(…internal.js).create(body, product)` |
| Dogfood AMD | HEAD `…/loader.js` | classic `require` + `workbench.web.main.js` |

## CI

Actions → CI → Run workflow → `heavy_build=web` → artifact `zcode-vscode-web`.

## Related

- [building-vscode.md](./building-vscode.md)
- [vscode-web.md](./vscode-web.md)
- [r6-terminal-e2e.md](./r6-terminal-e2e.md)
