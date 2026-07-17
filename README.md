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

# SPA + stateless /git-proxy on the same origin
node apps/cli/dist/cli.js web --dir apps/web/dist --port 5000
```

Open **http://127.0.0.1:5000/**

1. **Test proxy** → should show **proxy ok** (`/git-proxy/healthz`)
2. **Clone** → runs in a **Web Worker** (UI stays responsive); workspace saved to **IndexedDB**
3. Reopen from the **Workspace** dropdown after reload  
4. **Search** across text files · Edit → **Save** → **Commit**

No second proxy process is required. Defaults:

| URL | Role |
| --- | --- |
| `http://127.0.0.1:5000/` | Browser workspace SPA |
| `http://127.0.0.1:5000/git-proxy` | Stateless CORS bridge for GitHub/GitLab |

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
