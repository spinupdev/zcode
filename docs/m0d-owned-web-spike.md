# M0d — Owned VS Code Web build spike (pin 1.129.0)

Status: **scripts + docs ready**; full package is environment-bound (Node 24, disk, time).

## Goal

Replace dogfood `vscode-web@1.91.1` (`./scripts/fetch-vscode-web.sh`) with an **owned** static tree from `vendor/vscode@1.129.0` staged at `dist/vscode-web`.

## Prerequisites

| Item | Requirement |
| --- | --- |
| Node | **24.x** (see `vendor/vscode/.nvmrc`) |
| Disk free | **≥ 30 GB** recommended for package |
| RAM | 8 GB min; 16 GB+ preferred |
| Time | compile-web: tens of minutes; `vscode-web` package: 1h+ cold |
| Tooling | `npm` inside `vendor/vscode` only (not monorepo pnpm) |

```bash
# match upstream
nvm install 24 && nvm use
node -v   # v24.x

./scripts/build-web.sh --check
./scripts/build-web.sh --spike    # list *web* gulp tasks when deps present
```

## Gulp tasks (1.129)

From `vendor/vscode/build/gulpfile.vscode.web.ts` / `package.json`:

| Task | Purpose |
| --- | --- |
| `compile-web` | Compile browser workbench sources |
| `esbuild-vscode-web` | Esbuild bundle → `out-vscode-web` |
| `esbuild-vscode-web-min` | Minified bundle |
| `vscode-web` / `vscode-web-ci` | Product package under `.build/vscode-web` |
| `vscode-web-min` | Minified product package |

## Commands

```bash
# 1) deps (isolated npm)
./scripts/build-web.sh --deps-only

# 2) compile only (marker dist/web/.zcode-build.json)
./scripts/build-web.sh --compile-only

# 3) full package + stage dist/vscode-web
./scripts/build-web.sh --package

# 4) fetch prefers owned tree when .build/vscode-web exists
./scripts/fetch-vscode-web.sh
```

Serve:

```bash
pnpm --filter @zcode/workbench build
node apps/cli/dist/cli.js web --dir apps/web/dist --port 5000
# → /vscode/* from dist/vscode-web
```

## Success criteria

- [ ] `dist/vscode-web/out/vs/loader.js` exists  
- [ ] `dist/vscode-web/.zcode-vscode-web.json` has `"source": "owned"`  
- [ ] `/ide/` boots with owned tree (same workbench host)  
- [ ] `pnpm e2e:playwright` still green  

## Known blockers on small machines

| Symptom | Mitigation |
| --- | --- |
| Disk ~20GB free (this agent host) | Free space or run package on CI fat runner |
| Node 26 vs .nvmrc 24 | `nvm use 24` before gulp |
| OOM | `NODE_OPTIONS=--max-old-space-size=8192` (script default) |
| Timeouts | Use `workflow_dispatch` REH/web jobs; do not block PR CI |

## Dogfood vs owned

| Mode | Source | Use |
| --- | --- | --- |
| Dogfood | npm `vscode-web@1.91.1` | Local UX until owned tree exists |
| Owned | `gulp vscode-web` @ pin 1.129 | GA / version-aligned |

## Related

- [building-vscode.md](./building-vscode.md) — REH + web resource table  
- [vscode-web.md](./vscode-web.md) — `/ide` integration  
- [vscode-pin.md](./vscode-pin.md) — 1.129.0 pin  
