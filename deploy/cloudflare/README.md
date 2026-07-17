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

### Custom domain

1. Pages → Custom domains → add hostname  
2. Optional: Worker Triggers → `your-domain.com/git-proxy/*` (or rely on Pages Function)

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
