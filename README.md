# ZCode

**ZCode** is a dual-mode IDE based on [VS Code OSS](https://github.com/microsoft/vscode):

| Mode | Description |
| --- | --- |
| **Browser** | Full client-side workbench: OPFS workspace, isomorphic-git clone/commit, web extension host |
| **Remote** | Browser UI connects to a VS Code server in Docker (MVP) or microVM (later) |

The IDE **always starts in the browser**. Mode is workbench configuration (`remoteAuthority`, extension hosts, providers)—not a custom parallel editor RPC.

> **Not [coder/code-server](https://github.com/coder/code-server).**  
> This repository (`spinupdev/code-server` today; preferred rename **`spinupdev/zcode`**) is a separate greenfield product. CLI binary: **`zcode`**.

## Status

Early scaffolding (PR1 monorepo + R1 VS Code pin). See the architecture doc:

- [docs/design-dual-mode-vscode-ide.md](./docs/design-dual-mode-vscode-ide.md)
- [docs/vscode-pin.md](./docs/vscode-pin.md) — current VS Code tag/SHA
- [docs/quilt-workflow.md](./docs/quilt-workflow.md)

## Repo layout

```text
packages/     protocol, shell, browser-agent, server, git-proxy, …
apps/         cli (zcode), web (static workbench staging)
extensions/   zcode-browser-fs, zcode-git, zcode-diagnostics, …
vendor/       vscode (git submodule)
patches/      quilt series for vendor/vscode
scripts/      sync-vscode, build helpers
docs/         design + ADRs
```

## Prerequisites

- Node.js ≥ 20
- [pnpm](https://pnpm.io) 11+
- Git
- Optional: [quilt](https://savannah.nongnu.org/projects/quilt) for VS Code patches
- Optional: Docker (remote mode later)

## Quick start

```bash
pnpm install
pnpm build
pnpm test

# CLI skeleton
node apps/cli/dist/cli.js help

# Shell bootstrap harness (Track B1 — not the full workbench)
pnpm dev:shell
# open http://127.0.0.1:4173/?mode=browser

# VS Code submodule (already pinned on main; re-init if needed)
./scripts/add-vscode-submodule.sh
./scripts/sync-vscode.sh

# Server build prerequisites (full REH compile is long — see docs/building-vscode.md)
pnpm build:server:check
# ./scripts/build-server.sh          # full package when ready
```

**Dev vs production:** `@vscode/test-web` is never a production path. Set `ZCODE_ALLOW_TEST_WEB=1` only for local extension experiments. Owned web assets come from the OSS web build (M0).

## Planned CLI

```bash
zcode serve ./my-project --port 8080 --auth password
zcode git-proxy --port 8787 --allow-hosts github.com,gitlab.com
zcode web --dir dist/web --port 3000
```

## Implementation tracks

After monorepo bootstrap, work proceeds in **parallel**:

1. **Track R** — VS Code submodule → server build → cookie auth bridge → Docker → `zcode serve`
2. **Track B** — browser shell → OPFS → FileSystemProvider → git + proxy → search

Then merge: owned web build, dual-mode wiring, e2e.

## License

Product code: TBD.  
`vendor/vscode` remains under its upstream license (MIT).
