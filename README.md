# ZCode

> **Agents / new contributors:** start with **[`PLAN.md`](./PLAN.md)** (architecture + work tracker) and **[`AGENTS.md`](./AGENTS.md)**.

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

### Clone a Git repo (browser)

Git clone is **client-side** (isomorphic-git). The browser needs same-origin **`/git-proxy`** for GitHub/GitLab CORS.

```bash
# one terminal — SPA + /git-proxy + /ide
node apps/cli/dist/cli.js web --dir apps/web/dist --port 5000
```

1. Open **http://127.0.0.1:5000/** (the SPA, not only `/ide`)
2. Confirm **Git proxy URL** is `http://127.0.0.1:5000/git-proxy` (default)
3. Click **Test proxy** → green **proxy ok**
4. Set **Clone URL**, e.g. `https://github.com/isomorphic-git/isomorphic-git.git`
5. *(Private repos)* paste a **PAT** in **Token** (session only)
6. Click **Clone** → progress + file tree  
7. **Open in IDE** (or confirm dialog) → `/ide/?workspace=<id>` shows the **same files** in VS Code Web  
8. Edit → **Save** → **Commit** → **Push** (token needs write access)

Shared storage: IndexedDB database **`zcode-fs-v1`** (SPA + workbench).

Deep link (auto-start after proxy check):

```text
http://127.0.0.1:5000/?clone=https://github.com/org/repo.git&autoclone=1
```

From **VS Code Web** (`/ide/`): Command Palette → **“ZCode: Clone Repository (Browser SPA)”**.

**Notes:** HTTPS only (no SSH in browser). Token lives in `sessionStorage`, not `localStorage`.

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
pnpm e2e:browser      # node harness: proxy + clone
pnpm e2e:playwright   # browser UI: routes + SPA clone + IDE product
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
