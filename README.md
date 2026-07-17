# ZCode

**ZCode** is a dual-mode IDE based on [VS Code OSS](https://github.com/microsoft/vscode):

| Mode | Description |
| --- | --- |
| **Browser** | Client-side workspace: clone via isomorphic-git + **same-origin `/git-proxy`**, edit, commit |
| **Remote** | Password login + optional REH when server artifacts exist |

> **Not [coder/code-server](https://github.com/coder/code-server).** CLI: **`zcode`**.

## Quick start (one process)

```bash
pnpm install
pnpm build
./scripts/fetch-vscode-web.sh          # stage VS Code Web static assets
pnpm --filter @zcode/workbench build

# SPA + /git-proxy + /ide (VS Code Web) on one origin
node apps/cli/dist/cli.js web --dir apps/web/dist --port 5000
# or: pnpm dev:ide
```

| URL | Role |
| --- | --- |
| **http://127.0.0.1:5000/ide/** | **VS Code Web workbench (the IDE)** |
| http://127.0.0.1:5000/ | Lightweight browser git SPA (dogfood tools) |
| http://127.0.0.1:5000/git-proxy | Stateless CORS bridge for GitHub/GitLab |

### SPA tools (`/`)

1. **Test proxy** → **proxy ok**
2. **Clone** (Web Worker + IndexedDB)
3. **Search** · **Save** · **Commit**

### VS Code IDE (`/ide/`)

Real workbench from staged `dist/vscode-web`. Dual mode:

- Browser: `/ide/`
- Remote: `/ide/?mode=remote&authority=127.0.0.1:8080`

See [docs/vscode-web.md](./docs/vscode-web.md).

## Hosting (frontend + edge)

Browser mode is **static SPA + stateless proxy** — no durable backend required for public clones.

| Deploy | How |
| --- | --- |
| **Local / VM** | `zcode web` or `zcode serve` (both mount `/git-proxy`) |
| **Cloudflare Pages + Worker** | See [deploy/cloudflare/README.md](./deploy/cloudflare/README.md) |
| **Design notes** | [docs/hosting.md](./docs/hosting.md) |

App default: `gitProxyUrl = {origin}/git-proxy` (saved in `localStorage`; override with `?proxy=`).

## CLI

```bash
zcode web --dir apps/web/dist --port 5000          # SPA + /git-proxy
zcode serve . --port 8080 --password secret --no-reh
zcode git-proxy --port 8787                        # optional standalone
```

## Tests

```bash
pnpm test
pnpm smoke
pnpm e2e:browser   # same-origin proxy + real clone
```

## Layout

```text
packages/     protocol · shell · browser-agent · server · git-proxy
apps/         cli · web
deploy/
  cloudflare/git-proxy   # Worker for static hosts
  docker/                # container compose
docs/         design · hosting · vscode pin
```

## License

Product code: TBD. `vendor/vscode` remains MIT (upstream).
