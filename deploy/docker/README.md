# Docker self-host (H4)

Single-service image for **browser-mode** ZCode: SPA + password login + same-origin `/git-proxy`.

Remote REH/terminal is **optional** and not baked into the default image (platform-specific multi-GB artifact). Use `zcode serve` with a local `dist/server` for full remote IDE.

## Invariants

| Rule | How |
| --- | --- |
| Non-root | Image `USER 10001:10001` (`zcode`) |
| No secrets in URL | Login cookie only (KD12) |
| Stateless git-proxy | In-process `/git-proxy` |
| Multi-arch | `linux/amd64` + `linux/arm64` via `scripts/docker-build.sh --platforms …` |

## Build

```bash
# Host arch
bash scripts/docker-build.sh
# or:
docker build -f deploy/docker/Dockerfile.server -t zcode:local .

# Multi-arch → registry (buildx)
bash scripts/docker-build.sh \
  --platforms linux/amd64,linux/arm64 \
  --push \
  --tag ghcr.io/spinupdev/zcode:dev
```

## Run (compose)

```bash
cd deploy/docker
export ZCODE_PASSWORD='change-me'
docker compose up --build -d
curl -sS http://127.0.0.1:8080/healthz
# open http://127.0.0.1:8080/  → login → SPA
```

Workspace data: named volume `zcode-workspace` → `/home/workspace`.

## Run (plain docker)

```bash
docker run --rm -p 8080:8080 \
  -e ZCODE_PASSWORD=change-me \
  -v zcode-ws:/home/workspace \
  --user 10001:10001 \
  --security-opt no-new-privileges \
  zcode:local
```

## Health

- `GET /healthz` and `GET /readyz` → `{ ok: true, … }`
- Image `HEALTHCHECK` probes loopback `/healthz`

## Multi-arch notes

- Base: `node:22-bookworm-slim` (official multi-arch).
- Default `docker build` produces the **host** architecture only.
- Cross-build needs Docker Buildx + binfmt (Docker Desktop / `tonistiigi/binfmt`).
- Do **not** commit REH binaries into the image context; fetch/package per platform.

## Harden checklist

- [x] Non-root UID/GID 10001
- [x] `tini` as PID 1
- [x] `no-new-privileges` in compose
- [x] Healthcheck
- [x] Workspace volume not root-owned in image
- [x] `.dockerignore` excludes `vendor/`, REH, node_modules
- [ ] Optional: read-only rootfs + tmpfs (breaks some Node paths — deferred)
- [ ] Optional: distroless runtime (needs more packaging work)

## Related

- [docs/hosting.md](../../docs/hosting.md) — topologies
- [docs/hosting-production.md](../../docs/hosting-production.md) — Cloudflare Pages+Worker (H3)
- [docs/building-vscode.md](../../docs/building-vscode.md) — REH compile if layering remote
