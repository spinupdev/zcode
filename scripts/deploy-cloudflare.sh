#!/usr/bin/env bash
# Deploy ZCode browser mode to Cloudflare:
#   1) Standalone Worker (zcode-git-proxy) — optional second origin / custom routes
#   2) Pages project (zcode) — SPA + same-origin /git-proxy Pages Function
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT}"

PROJECT_NAME="${ZCODE_CF_PAGES_PROJECT:-zcode}"
WORKER_NAME="${ZCODE_CF_WORKER_NAME:-zcode-git-proxy}"
SKIP_WORKER="${ZCODE_CF_SKIP_WORKER:-0}"
BRANCH="${ZCODE_CF_PAGES_BRANCH:-main}"

log() { printf '==> %s\n' "$*"; }
die() { echo "error: $*" >&2; exit 1; }

command -v npx >/dev/null || die "npx required"
command -v pnpm >/dev/null || die "pnpm required"

log "wrangler whoami"
npx --yes wrangler whoami

log "build SPA (apps/web)"
pnpm --filter @zcode/web build
test -f apps/web/dist/index.html || die "missing apps/web/dist/index.html"

SITE="${ROOT}/deploy/cloudflare/site"
mkdir -p "${SITE}/dist"
log "stage Pages assets → deploy/cloudflare/site/dist"
rm -rf "${SITE}/dist"
mkdir -p "${SITE}/dist"
cp -R apps/web/dist/. "${SITE}/dist/"

# Ensure SPA falls through for client routes (if any)
if [[ ! -f "${SITE}/dist/_redirects" ]]; then
  printf '/*    /index.html   200\n' > "${SITE}/dist/_redirects"
fi

if [[ "${SKIP_WORKER}" != "1" ]]; then
  log "deploy Worker ${WORKER_NAME}"
  (
    cd "${ROOT}/deploy/cloudflare/git-proxy"
    npx --yes wrangler deploy --name "${WORKER_NAME}"
  )
else
  log "skip Worker (ZCODE_CF_SKIP_WORKER=1)"
fi

log "ensure Pages project ${PROJECT_NAME} exists"
if ! npx --yes wrangler pages project list 2>/dev/null | grep -q "${PROJECT_NAME}"; then
  npx --yes wrangler pages project create "${PROJECT_NAME}" --production-branch "${BRANCH}" || true
fi

log "deploy Pages project ${PROJECT_NAME} (branch=${BRANCH})"
(
  cd "${SITE}"
  # functions/ next to dist is auto-detected by wrangler pages deploy
  npx --yes wrangler pages deploy dist \
    --project-name "${PROJECT_NAME}" \
    --branch "${BRANCH}" \
    --commit-dirty=true
)

log "done"
cat <<EOF

Next:
  1. Open the Pages URL from the deploy output (*.pages.dev)
  2. curl -sS https://<pages-host>/git-proxy/healthz
  3. In the SPA: Test proxy → should be green (same-origin /git-proxy)

Standalone Worker (if deployed): workers.dev URL from deploy output
  Use when attaching a custom domain route: <host>/git-proxy/* → ${WORKER_NAME}

Custom domain (optional):
  Pages → Custom domains → add hostname
  Workers → ${WORKER_NAME} → Triggers → route <host>/git-proxy/*
  (Pages Function already provides same-origin on *.pages.dev)
EOF
