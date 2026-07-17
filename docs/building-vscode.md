# Building VS Code (server / web)

ZCode owns builds of `microsoft/vscode` at the pin in [vscode-pin.md](./vscode-pin.md).
Product wrappers live outside the submodule; only thin quilt patches may touch core.

## Requirements

| Resource | Minimum (dogfood) | Recommended (CI) |
| --- | --- | --- |
| Disk free | **40 GB** | **64 GB+** |
| RAM | 8 GB | 16 GB+ |
| CPU | 4 cores | 8+ cores |
| Time (cold) | 1–3+ hours | cache deps + `out*` |
| Network | npm registry | optional mirror |

Upstream uses **npm** (not pnpm) inside `vendor/vscode`. Keep that environment isolated from the monorepo’s pnpm workspace.

## Scripts

```bash
# Apply quilt patches
./scripts/sync-vscode.sh

# Install vscode deps + compile server sources (dev) and package REH (optional)
./scripts/build-server.sh              # compile + package default platform
./scripts/build-server.sh --check      # prerequisites only
./scripts/build-server.sh --deps-only  # npm ci in vendor/vscode
./scripts/build-server.sh --compile-only
./scripts/build-server.sh --skip-package

# Web compile (M0 path; not production CDN yet)
./scripts/build-web.sh --check
./scripts/build-web.sh --compile-only
```

Artifacts (when packaging succeeds):

| Output | Path |
| --- | --- |
| REH package | `dist/server/` (copied from `vendor/vscode/.build/vscode-reh-*`) |
| Dev server entry | `vendor/vscode/scripts/code-server.sh` (requires compile) |
| Web out | `vendor/vscode/out/` / later staged to `apps/web/dist` |

## Gulp targets used

From VS Code `build/gulpfile.reh.ts` / package scripts:

- `npm run gulp compile` — client/server sources for dev
- `npm run gulp compile-web` — browser workbench sources
- `npm run gulp vscode-reh-<platform>-<arch>` — remote extension host package  
  Example: `vscode-reh-linux-x64`, `vscode-reh-darwin-arm64`

Platform defaults from `uname` (override with `ZCODE_REH_PLATFORM` / `ZCODE_REH_ARCH`).

## Phase 0 fallback (dogfood without owning the build)

If a full REH build is blocked (disk/time), temporarily wrap a prebuilt server:

```bash
# Example only — not the long-term production path
docker pull gitpod/openvscode-server:latest
# CLI will wrap this in R3/R5; do not ship as "owned" ZCode builds
```

GA must use **owned** `microsoft/vscode` artifacts (KD19).

## CI policy

- Default PR CI: monorepo + quilt push only (fast).
- Full REH compile: **workflow_dispatch** / scheduled job on fat runners with multi-hour timeout and cache of `vendor/vscode/node_modules` + npm cache.
- Never cache or publish `.vscode-test-web` as product output.

## Failure modes

| Symptom | Mitigation |
| --- | --- |
| OOM during gulp | Raise `NODE_OPTIONS=--max-old-space-size=8192` (script sets this) |
| ENOSPC | Free disk; clean `vendor/vscode/out*` and `.build` |
| yarn/npm peer hell | Use upstream lockfile only inside `vendor/vscode` |
| Patch apply fail | `quilt push -a` and refresh series before build |
