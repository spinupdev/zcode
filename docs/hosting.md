# Hosting ZCode (browser mode)

## You do **not** need a stateful service for public browser git

| Component | Stateful? | Deploy as |
| --- | --- | --- |
| SPA (`apps/web`) | No | Static host / CDN / Pages |
| Git CORS proxy (`/git-proxy`) | **No** (request in → request out) | Worker / serverless / Node route |
| Workspace data | Yes, **client-side** | Browser memory / OPFS |
| Remote IDE (REH/Docker) | Yes | Separate product later |

## Recommended topology

```text
[ Static SPA ]
      |
      | same origin
      v
[ /git-proxy ]  --HTTPS-->  github.com / gitlab.com
```

### Local one-process

```bash
pnpm --filter @zcode/web build
node apps/cli/dist/cli.js web --dir apps/web/dist --port 5000
# SPA:        http://127.0.0.1:5000/
# git-proxy:  http://127.0.0.1:5000/git-proxy
```

### Cloudflare

See [deploy/cloudflare/README.md](../deploy/cloudflare/README.md) and the production checklist **[hosting-production.md](./hosting-production.md)** (H3).

### Self-host with login

```bash
node apps/cli/dist/cli.js serve . --port 8080 --password secret --no-reh
# mounts /git-proxy + static apps/web/dist when present
```

## App config

Default `gitProxyUrl` = `{window.location.origin}/git-proxy`.

Override:

- UI “App config” (persisted in `localStorage`)
- Query: `?proxy=https://cdn.example/git-proxy`

## Security notes

- Proxy allowlists hosts (GitHub/GitLab/Bitbucket by default)
- Blocks private IP targets (SSRF)
- Stateless — scale Workers horizontally without sticky sessions
