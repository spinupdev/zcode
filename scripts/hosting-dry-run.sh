#!/usr/bin/env bash
# H3 — production hosting dry-run (no account required for local steps).
# Live Pages+Worker deploy still needs `npx wrangler login` + Cloudflare account.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT}"

DEPLOY=0
usage() {
  cat <<'EOF'
Usage: scripts/hosting-dry-run.sh [--deploy]

  Default: build SPA, typecheck/validate Worker sources, print deploy checklist.
  --deploy: also run wrangler deploy (requires login + account; not default).

See docs/hosting-production.md for the full H3 runbook.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --deploy) DEPLOY=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "unknown arg: $1" >&2; usage; exit 2 ;;
  esac
done

log() { printf '==> %s\n' "$*"; }
warn() { echo "warning: $*" >&2; }
ok() { printf '  OK  %s\n' "$*"; }

log "1/4 Build SPA (apps/web)"
pnpm --filter @zcode/web build
test -f apps/web/dist/index.html
ok "apps/web/dist/index.html"

log "2/4 Validate Worker sources"
WORKER_DIR="deploy/cloudflare/git-proxy"
test -f "${WORKER_DIR}/wrangler.toml"
test -f "${WORKER_DIR}/src/worker.ts"
# Prefer monorepo TypeScript if the package has a check; else node syntax check via strip
if [[ -f "${WORKER_DIR}/package.json" ]] && grep -q '"typecheck"' "${WORKER_DIR}/package.json" 2>/dev/null; then
  pnpm --dir "${WORKER_DIR}" run typecheck
else
  # Ensure entry is non-empty TS
  test -s "${WORKER_DIR}/src/worker.ts"
fi
ok "wrangler.toml + worker.ts present"

log "3/4 wrangler dry-run (if CLI available)"
if command -v npx >/dev/null 2>&1; then
  if npx --yes wrangler --version >/dev/null 2>&1; then
    # `deploy --dry-run` uploads nothing; still may need account for some plans
    if (cd "${WORKER_DIR}" && npx --yes wrangler deploy --dry-run 2>&1); then
      ok "wrangler deploy --dry-run"
    else
      warn "wrangler deploy --dry-run failed (login/account may be required) — local checks still OK"
    fi
  else
    warn "wrangler not runnable via npx; skip dry-run"
  fi
else
  warn "npx missing; skip wrangler dry-run"
fi

if [[ "${DEPLOY}" == "1" ]]; then
  log "4/4 LIVE deploy (user requested --deploy)"
  (cd "${WORKER_DIR}" && npx --yes wrangler deploy)
  log "Pages: npx wrangler pages deploy apps/web/dist --project-name=zcode"
  npx --yes wrangler pages deploy apps/web/dist --project-name=zcode
else
  log "4/4 Checklist (no live deploy)"
  cat <<'EOF'
  [ ] npx wrangler login
  [ ] cd deploy/cloudflare/git-proxy && npx wrangler deploy
  [ ] Attach route: <host>/git-proxy/* → worker
  [ ] pnpm --filter @zcode/web build
  [ ] npx wrangler pages deploy apps/web/dist --project-name=zcode
  [ ] curl -sS https://<host>/git-proxy/healthz  → mode:stateless
  [ ] SPA Test proxy green; no tkn/connectionToken in URL bar

  Full runbook: docs/hosting-production.md
  Re-run with --deploy only after wrangler login (shared external action).
EOF
fi

log "hosting-dry-run OK"
