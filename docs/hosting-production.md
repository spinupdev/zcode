# H3 — Production hosting runbook (Pages + Worker)

Goal: ship **browser-mode** ZCode (SPA + stateless `/git-proxy`) on Cloudflare without a stateful control plane.

Remote IDE (REH / `zcode serve`) is a **separate** self-host path — not required for Pages+Worker.

## Architecture

```text
https://zcode.example.com/
  ├── /                 → Cloudflare Pages (apps/web/dist)
  ├── /git-proxy/*      → Cloudflare Worker (deploy/cloudflare/git-proxy)
  └── (optional later)  → /ide + REH on a Node host (not Pages)
```

Invariants:

- Git proxy is **stateless** (no repo storage)
- No secrets in URLs (KD12)
- Same hostname for SPA + proxy (same-origin)

## Prerequisites

| Item | Notes |
| --- | --- |
| Cloudflare account | Pages + Workers enabled |
| Domain | Optional custom domain on Pages |
| Node 20+ / pnpm 11 | Local build |
| Wrangler | `npx wrangler` (login once) |

```bash
npx wrangler login
```

## 1. Build static SPA

```bash
pnpm install
pnpm --filter @zcode/web build
# output: apps/web/dist  (index.html, app.js, git-worker.js, …)
ls apps/web/dist/index.html
```

Optional: stage VS Code Web only if you also host `/ide` on the same Pages project (usually **not** — keep IDE on Node/`zcode serve`).

## 2. Deploy Worker (`/git-proxy`)

```bash
cd deploy/cloudflare/git-proxy
# Review wrangler.toml name + account
npx wrangler deploy
```

Attach a **route** on the same hostname as Pages:

| Route | Worker |
| --- | --- |
| `zcode.example.com/git-proxy/*` | `zcode-git-proxy` (or name from wrangler.toml) |

Dashboard: Workers → your worker → Triggers → Add route.

Alternatively use [Workers for Platforms / zone routes](https://developers.cloudflare.com/workers/configuration/routing/routes/) so `/*` still hits Pages for non-proxy paths.

### Verify Worker alone

```bash
curl -sS https://zcode.example.com/git-proxy/healthz
# expect: {"ok":true,"service":"zcode-git-proxy",... "mode":"stateless"}
```

## 3. Deploy Pages

```bash
# from monorepo root
pnpm --filter @zcode/web build
npx wrangler pages deploy apps/web/dist --project-name=zcode
```

- Bind custom domain `zcode.example.com` to the Pages project
- Ensure **Worker route takes precedence** for `/git-proxy/*` (Cloudflare: more specific Worker routes win)

### SPA routing

If deep links 404, add Pages `_redirects` or `public/_routes` so non-file paths serve `index.html`. Current SPA is mostly `/` + assets; git-worker is a static file.

## 4. End-to-end browser check

1. Open `https://zcode.example.com/`
2. **Test proxy** → green / `ok:true`
3. Clone a **public** HTTPS repo (e.g. a tiny public fixture)
4. Edit → commit → (optional) push with PAT in sessionStorage only

Private clone requires a PAT in the SPA (never put tokens in the URL).

## 5. Headers / CSP (optional edge)

Browser SPA is simpler than full VS Code Web. If you add a transform rule CSP:

- Allow `connect-src 'self'` for `/git-proxy`
- Worker must not strip CORS headers it sets

Self-host IDE CSP is applied by `@zcode/server` on HTML (M2) — not by Pages for SPA-only.

## 6. Rollback

| Layer | Rollback |
| --- | --- |
| Pages | Deploy previous deployment in Pages UI / `wrangler pages deployment list` |
| Worker | `wrangler rollback` or redeploy prior version |

## 7. Checklist (agent / release)

- [ ] `pnpm --filter @zcode/web build` succeeds
- [ ] Worker `healthz` returns `mode:stateless`
- [ ] SPA **Test proxy** green on production hostname
- [ ] Public clone completes without server-side storage
- [ ] No `tkn` / `connectionToken` in browser location bar
- [ ] Worker allowlist still blocks non-git hosts / private IPs

## 8. Out of scope for this runbook

| Path | Where |
| --- | --- |
| `/ide` VS Code Web | Self-host `zcode serve` or fat Docker (R5/R4) |
| REH / terminal | `dist/server` + cookie proxy (R2c/R3b/R6) |
| Multi-tenant SaaS | microVM orchestrator (P3) — not Docker multi-tenant |

## Related

- [hosting.md](./hosting.md) — local topology
- [deploy/cloudflare/README.md](../deploy/cloudflare/README.md) — Worker details
- [m2-diagnostics-csp.md](./m2-diagnostics-csp.md) — CSP on IDE host
