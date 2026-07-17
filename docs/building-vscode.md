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
| Network | npm registry + GitHub releases | `GITHUB_TOKEN` for `@vscode/ripgrep` |
| Node | **24.x** (`vendor/vscode/.nvmrc`) | setup-node 24 on fat jobs |

Upstream uses **npm** (not pnpm) inside `vendor/vscode`. Keep that environment isolated from the monorepo’s pnpm workspace.

## Scripts

```bash
# Apply quilt patches
./scripts/sync-vscode.sh

# Install vscode deps + compile server sources (dev) and package REH (optional)
export GITHUB_TOKEN="$(gh auth token)"   # recommended — avoids ripgrep 403
./scripts/build-server.sh              # compile + package default platform
./scripts/build-server.sh --check      # prerequisites only
./scripts/build-server.sh --deps-only  # npm ci in vendor/vscode
./scripts/build-server.sh --compile-only
./scripts/build-server.sh --skip-package

# Web compile / package (M0d owned assets)
./scripts/build-web.sh --check
./scripts/build-web.sh --spike          # list web gulp tasks + Node hints
./scripts/build-web.sh --compile-only   # gulp compile-web
./scripts/build-web.sh --package        # gulp vscode-web → dist/vscode-web
```

See also [m0d-owned-web-spike.md](./m0d-owned-web-spike.md), [reh-cookie-proxy.md](./reh-cookie-proxy.md), and [r6-terminal-e2e.md](./r6-terminal-e2e.md).

Artifacts (when packaging succeeds):

| Output | Path |
| --- | --- |
| REH package | `dist/server/` (copied from `vendor/vscode/.build/vscode-reh-*`) + `.zcode-build.json` |
| Dev server entry | `vendor/vscode/scripts/code-server.sh` (requires compile) |
| Owned web | `dist/vscode-web/` + `.zcode-vscode-web.json` with `"source":"owned"` |

**Never commit** REH binaries or the full `dist/server` tree.

## Gulp targets used

From VS Code `build/gulpfile.reh.ts` / package scripts:

- `npm run gulp compile` — client/server sources for dev
- `npm run gulp compile-web` — browser workbench sources
- `npm run gulp vscode-web` — owned web product package
- `npm run gulp vscode-reh-<platform>-<arch>` — remote extension host package  
  Example: `vscode-reh-linux-x64`, `vscode-reh-darwin-arm64`

Platform defaults from `uname` (override with `ZCODE_REH_PLATFORM` / `ZCODE_REH_ARCH`).

## Phase 0 fallback (dogfood without owning the build)

If a full REH / web build is blocked (disk/time/token), temporarily wrap dogfood assets:

```bash
./scripts/fetch-vscode-web.sh   # vscode-web@1.91.1 → dist/vscode-web (source=dogfood-npm)
```

GA must use **owned** `microsoft/vscode` artifacts (KD19).

## Cookie-auth REH attach

Once `dist/server` exists, `zcode serve` spawns REH and reverse-proxies with HttpOnly cookies — see [reh-cookie-proxy.md](./reh-cookie-proxy.md).

## CI policy

- Default PR CI: monorepo + quilt + `build-*-sh --check` only (fast).
- Full REH compile: **workflow_dispatch** → `heavy_build=reh` (Node 24, disk free, multi-hour).
- Owned web package: **workflow_dispatch** → `heavy_build=web`.
- R6 terminal e2e: **workflow_dispatch** → `heavy_build=reh-and-e2e` (REH artifact + Playwright).
- Never cache or publish `.vscode-test-web` as product output.

### Exact dispatch commands

```text
GitHub → Actions → CI → Run workflow
  heavy_build: reh | web | reh-and-e2e | none
```

Artifacts:

| Job | Artifact name | Local extract |
| --- | --- | --- |
| vscode-reh-build | `zcode-reh-linux-x64` | → `dist/server/` |
| vscode-web-build | `zcode-vscode-web` | → `dist/vscode-web/` |

### Download Linux REH into `dist/server` (optional e2e)

After a successful **heavy_build=reh** (or **reh-and-e2e**) run, pull the artifact locally:

```bash
# Requires: gh auth + jq
./scripts/fetch-reh-artifact.sh
# or:
pnpm fetch:reh

# Pin a run:
./scripts/fetch-reh-artifact.sh --run-id 123456789
./scripts/fetch-reh-artifact.sh --repo spinupdev/zcode --force
```

This stages `dist/server/` (marker + binaries; **not committed**). On **Linux**, follow with:

```bash
ZCODE_E2E_REH_REQUIRED=1 pnpm e2e:reh
```

On **macOS**, a Linux REH binary will not execute; use a local `./scripts/build-server.sh` (darwin-arm64) or CI job **vscode-reh-e2e**.

## Failure modes

| Symptom | Mitigation |
| --- | --- |
| OOM during gulp | Raise `NODE_OPTIONS=--max-old-space-size=8192` (script sets this) |
| ENOSPC | Free disk; clean `vendor/vscode/out*` and `.build` |
| `@vscode/ripgrep` 403 | Set `GITHUB_TOKEN`; CI injects `secrets.GITHUB_TOKEN` |
| yarn/npm peer hell | Use upstream lockfile only inside `vendor/vscode` |
| Patch apply fail | `quilt push -a` and refresh series before build |
| Node major ≠ 24 | Portable Node 24 or nvm/fnm before `build-*.sh` |

## Agent session notes (2026-07-17)

- Local host: disk often **&lt;20–40 GB free**; package not attempted after deps failed.
- Node host default was **26**; portable **24.18.0** used for `--check`.
- `npm ci` in `vendor/vscode` failed on ripgrep GitHub **403** without token.
- Dogfood path remains green for `/ide/` until owned package lands via CI or a fat machine.
