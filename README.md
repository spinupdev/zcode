# ZCode

**ZCode** is a dual-mode IDE based on [VS Code OSS](https://github.com/microsoft/vscode):

| Mode | Description |
| --- | --- |
| **Browser** | Client-side workspace: clone via isomorphic-git + git-proxy, edit, commit |
| **Remote** | Browser UI + password login; optional REH spawn when server artifacts exist |

> **Not [coder/code-server](https://github.com/coder/code-server).**  
> Preferred repo rename: `spinupdev/zcode`. CLI: **`zcode`**.

## Quick start — run the integrated browser workspace

```bash
pnpm install
pnpm build

# terminal 1 — CORS proxy for GitHub/GitLab git HTTP
node apps/cli/dist/cli.js git-proxy --port 8787

# terminal 2 — browser workspace UI
node apps/cli/dist/cli.js web --dir apps/web/dist --port 3000
```

Open **http://127.0.0.1:3000/** → set clone URL → **Clone** → edit → **Save** → **Commit**.

### Or one server (login + static app)

```bash
node apps/cli/dist/cli.js serve . --port 8080 --password secret --no-reh
```

Open http://127.0.0.1:8080/ → login → browser workspace at `/index.html` (when `apps/web/dist` exists).

### Shell bootstrap harness (config only)

```bash
pnpm dev:shell
# http://127.0.0.1:4173/?mode=browser
```

## CLI

```bash
zcode serve [dir] --port 8080 --password secret [--static-dir apps/web/dist] [--no-reh]
zcode git-proxy --port 8787 --allow-hosts github.com,gitlab.com
zcode web --dir apps/web/dist --port 3000
```

## Tests & checks

```bash
pnpm test
pnpm build:server:check   # REH build prerequisites
pnpm smoke
```

## Layout

```text
packages/     protocol · shell · browser-agent · server · git-proxy · …
apps/         cli · web (browser workspace UI)
extensions/   zcode-browser-fs · zcode-git · …
vendor/       vscode @ 1.129.0 (submodule)
deploy/docker compose + Dockerfile
docs/         design + build guides
```

## Docker

```bash
docker compose -f deploy/docker/compose.yaml up --build
# app :8080  git-proxy :8787
```

## Docs

- [Architecture design](./docs/design-dual-mode-vscode-ide.md)
- [VS Code pin](./docs/vscode-pin.md)
- [Building VS Code REH](./docs/building-vscode.md)

## License

Product code: TBD. `vendor/vscode` remains MIT (upstream).
