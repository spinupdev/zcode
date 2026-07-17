# ZCode

> **Agents / new contributors:** start with **[`PLAN.md`](./PLAN.md)** (architecture + work tracker) and **[`AGENTS.md`](./AGENTS.md)**.

**ZCode** is a dual-mode IDE based on [VS Code OSS](https://github.com/microsoft/vscode):

| Mode | Description |
| --- | --- |
| **Browser** | Client-side workspace: clone via isomorphic-git + **same-origin `/git-proxy`**, edit, commit |
| **Remote** | Password login + optional REH when server artifacts exist |

> **Not [coder/code-server](https://github.com/coder/code-server).** CLI: **`zcode`**. Source: [github.com/spinupdev/zcode](https://github.com/spinupdev/zcode).

## Quick start (one process)

```bash
pnpm install
pnpm build
./scripts/fetch-vscode-web.sh          # stage VS Code Web static assets
pnpm --filter @zcode/workbench build

# product IDE at / + /git-proxy; SPA debug at /debug/ in DEV
NODE_ENV=development node apps/cli/dist/cli.js web --dir apps/web/dist --port 5000 --spa-debug
# or: pnpm dev:ide
```

| URL | Role |
| --- | --- |
| **http://127.0.0.1:5000/** | **VS Code Web workbench (the product IDE)** |
| http://127.0.0.1:5000/debug/ | Debug SPA (git dogfood) — **DEV only**; off when `NODE_ENV=production` |
| http://127.0.0.1:5000/git-proxy | Stateless CORS bridge for GitHub/GitLab |

### Clone a Git repo (browser debug SPA)

Git clone is **client-side** (isomorphic-git). The browser needs same-origin **`/git-proxy`** for GitHub/GitLab CORS. The SPA at `/debug/` is **debug dogfood** and is **not served in production**.

```bash
# one terminal — product IDE + /git-proxy + optional /debug
NODE_ENV=development node apps/cli/dist/cli.js web --dir apps/web/dist --port 5000 --spa-debug
```

1. Open **http://127.0.0.1:5000/debug/** (debug SPA; product IDE is **`/`**)
2. Confirm **Git proxy URL** is `http://127.0.0.1:5000/git-proxy` (default)
3. Click **Test proxy** → green **proxy ok**
4. Set **Clone URL**, e.g. `https://github.com/isomorphic-git/isomorphic-git.git`
5. *(Private repos)* paste a **PAT** in **Token** (session only)
6. Click **Clone** → progress + file tree  
7. **Open in IDE** (or confirm dialog) → `/?workspace=<id>` shows the **same files** in VS Code Web  
8. Edit → **Save** → **Commit** → **Push** (token needs write access)

Shared storage: **OPFS** (ZenFS, primary) with IndexedDB **`zcode-fs-v1`** fallback (SPA + workbench).

Deep link (auto-start after proxy check):

```text
http://127.0.0.1:5000/debug/?clone=https://github.com/org/repo.git&autoclone=1
```

From **VS Code Web** (`/`): Command Palette → **“ZCode: Clone Repository (Browser SPA)”**.

**Notes:** HTTPS only (no SSH in browser). Token lives in `sessionStorage`, not `localStorage`.

### VS Code IDE (`/`)

Real workbench from staged `dist/vscode-web`. Dual mode:

- Browser: `/` or `/?workspace=<id>`
- Remote: `/?mode=remote&authority=127.0.0.1:8080`

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
NODE_ENV=development zcode web --dir apps/web/dist --port 5000 --spa-debug   # DEV SPA + /git-proxy
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
