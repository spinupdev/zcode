# Cloudflare hosting (static SPA + stateless git-proxy)

Browser mode does **not** need a stateful backend. You need:

1. **Static assets** — `apps/web/dist` on Cloudflare Pages
2. **Stateless `/git-proxy`** — Pages Function (same-origin) and/or standalone Worker

```text
https://zcode-69r.pages.dev/              →  Pages (SPA)
https://zcode-69r.pages.dev/git-proxy/*   →  Pages Function (deploy/cloudflare/site/functions)
https://zcode-git-proxy.*.workers.dev/*   →  optional standalone Worker (this folder’s sibling)
```

The SPA defaults `gitProxyUrl` to `{origin}/git-proxy` (same-origin).

**Note:** Full VS Code Web IDE (`/`) is self-hosted (`zcode serve` / Docker). Pages ships the **browser git SPA** only.

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
