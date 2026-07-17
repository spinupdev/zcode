# Cloudflare hosting (static SPA + stateless git-proxy)

Browser mode does **not** need a stateful backend. You need:

1. **Static assets** — `apps/web/dist` on Cloudflare Pages (or any CDN)
2. **Stateless `/git-proxy`** — Cloudflare Worker that forwards git smart-HTTP and adds CORS

```text
https://zcode.example.com/           →  Pages (SPA)
https://zcode.example.com/git-proxy/* →  Worker (this folder)
```

The SPA defaults `gitProxyUrl` to `{origin}/git-proxy`.

## Deploy Worker

```bash
cd deploy/cloudflare/git-proxy
npx wrangler login
npx wrangler deploy
```

Then attach a route in the Cloudflare dashboard (or `wrangler.toml` `routes`):

| Route | Destination |
| --- | --- |
| `zcode.example.com/git-proxy/*` | `zcode-git-proxy` worker |

## Deploy Pages

```bash
pnpm --filter @zcode/web build
npx wrangler pages deploy apps/web/dist --project-name=zcode
```

Point the custom domain at the Pages project. Ensure the Worker route is on the **same hostname** so the browser uses same-origin proxy (no extra CORS hop).

## Verify

```bash
curl -sS https://zcode.example.com/git-proxy/healthz
# {"ok":true,"service":"zcode-git-proxy",...}
```

Open the app → **Test proxy** should show green.

## Optional: standalone proxy port

`zcode git-proxy --port 8787` remains available for local debugging. Production should prefer **same-origin `/git-proxy`**.
