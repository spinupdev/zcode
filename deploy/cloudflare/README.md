# Cloudflare hosting (browser-mode IDE + git proxy)

Browser mode does **not** need a stateful backend. Pages ships:

1. **Product IDE at `/`** — VS Code Web workbench + `/vscode` + `/extensions`
2. **Debug SPA at `/debug/`** — git dogfood tools (optional)
3. **Stateless `/git-proxy`** — Pages Function (same-origin) and/or standalone Worker

```text
https://zcode-69r.pages.dev/              →  VS Code Web IDE (browser mode)
https://zcode-69r.pages.dev/vscode/*      →  vscode-web static
https://zcode-69r.pages.dev/extensions/*  →  zcode-* web extensions
https://zcode-69r.pages.dev/debug/        →  debug git SPA (DEV dogfood)
https://zcode-69r.pages.dev/git-proxy/*   →  Pages Function
https://zcode-git-proxy.*.workers.dev/*   →  optional standalone Worker
```

**Remote mode (REH / PTY)** still needs self-host (`zcode serve` / Docker) — not on Pages.

**File-size note:** Cloudflare Pages max file is **25 MiB**. Owned 1.129 esbuild workbench (~33 MiB) is too large, so deploy stages **dogfood `vscode-web@1.91`** for CDN unless `ZCODE_CF_VSCODE_WEB_DIR` points at a Pages-safe tree.

## One-shot deploy

```bash
npx wrangler login   # once
pnpm deploy:cloudflare
# or: bash scripts/deploy-cloudflare.sh
```

This:

1. Builds `apps/web`
2. Deploys Worker `zcode-git-proxy` (standalone / custom domain routes)
3. Deploys Pages project `zcode` with SPA + same-origin `/git-proxy` Function

## Deploy pieces manually

### Worker only

```bash
cd deploy/cloudflare/git-proxy
npx wrangler deploy
```

### Pages only

```bash
pnpm --filter @zcode/web build
rm -rf deploy/cloudflare/site/dist && mkdir -p deploy/cloudflare/site/dist
cp -R apps/web/dist/. deploy/cloudflare/site/dist/
cd deploy/cloudflare/site
npx wrangler pages deploy dist --project-name=zcode --branch main
```

### Custom domain (important)

The **IDE** is Cloudflare **Pages** (`zcode`). The **Worker** is proxy-only.

| Correct | Wrong |
| --- | --- |
| Pages → `zcode` → Custom domains → `zcode.example.com` | Worker custom domain / route `zcode.example.com/*` for the whole site |
| Optional Worker route: `zcode.example.com/git-proxy/*` only | Pointing apex at Worker and expecting `/` to load the IDE |

**Steps:**

1. **Pages** → project **`zcode`** → **Custom domains** → **Set up a custom domain** → `zcode.dvito.cloud` (or your host).  
   Cloudflare will guide DNS (usually a CNAME to the Pages project).
2. **Workers** → **`zcode-git-proxy`** → **Triggers**:
   - **Remove** any catch-all like `zcode.dvito.cloud/*` or “Custom domain” that sends **all** traffic to the Worker.
   - You do **not** need a Worker route if you use the Pages Function (same-origin `/git-proxy` on the Pages hostname).
3. Verify:

```bash
# Must be the IDE HTML (ZCode IDE / monaco-parts-splash), NOT JSON not_found
curl -sS https://zcode.dvito.cloud/ | head

# Same-origin proxy via Pages Function (runtime: cloudflare-pages-function)
curl -sS https://zcode.dvito.cloud/git-proxy/healthz
```

If `/` returns `{"error":"not_found","hint":"mount this worker at /git-proxy/*"}`, the hostname is still on the **Worker**. Move it to **Pages**.

## Verify

```bash
curl -sS https://zcode-69r.pages.dev/git-proxy/healthz
# {"ok":true,"service":"zcode-git-proxy",...,"runtime":"cloudflare-pages-function"}

curl -sS https://zcode-git-proxy.aaqaishtyaq.workers.dev/git-proxy/healthz
# {"ok":true,...,"runtime":"cloudflare-worker"}
```

Open the Pages URL → **Test proxy** should show green.

## Optional: standalone proxy port

`zcode git-proxy --port 8787` remains available for local debugging. Production should prefer **same-origin `/git-proxy`**.
