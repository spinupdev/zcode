#!/usr/bin/env bash
# Deploy ZCode browser-mode IDE to Cloudflare Pages (+ optional git-proxy Worker).
#
# Pages layout (product):
#   /                 → VS Code Web workbench (apps/workbench)
#   /vscode/*         → staged vscode-web static (dogfood AMD if owned >25MiB)
#   /extensions/*     → zcode-* web extensions (package.json + dist only)
#   /debug/*          → optional git SPA dogfood (apps/web)
#   /git-proxy/*      → Pages Function (same-origin)
#
# Note: Cloudflare Pages max file size is 25 MiB. Owned esbuild workbench bundles
# (~33 MiB) exceed that, so this script stages dogfood vscode-web@1.91 for CDN
# unless ZCODE_CF_VSCODE_WEB_DIR points at a Pages-safe tree.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT}"

PROJECT_NAME="${ZCODE_CF_PAGES_PROJECT:-zcode}"
WORKER_NAME="${ZCODE_CF_WORKER_NAME:-zcode-git-proxy}"
SKIP_WORKER="${ZCODE_CF_SKIP_WORKER:-0}"
SKIP_DEBUG_SPA="${ZCODE_CF_SKIP_DEBUG_SPA:-0}"
BRANCH="${ZCODE_CF_PAGES_BRANCH:-main}"
DOGFOOD_VERSION="${VSCODE_WEB_NPM_VERSION:-1.91.1}"
MAX_FILE_BYTES=$((25 * 1024 * 1024))

log() { printf '==> %s\n' "$*"; }
die() { echo "error: $*" >&2; exit 1; }

command -v npx >/dev/null || die "npx required"
command -v pnpm >/dev/null || die "pnpm required"
command -v curl >/dev/null || die "curl required"

log "wrangler whoami"
npx --yes wrangler whoami

SITE="${ROOT}/deploy/cloudflare/site"
STAGE="${SITE}/dist"
rm -rf "${STAGE}"
mkdir -p "${STAGE}"

log "build workbench + extensions + debug SPA"
pnpm --filter @zcode/workbench build
pnpm --filter zcode-browser-fs build
pnpm --filter zcode-git build
pnpm --filter zcode-diagnostics build
pnpm --filter @zcode/web build
test -f apps/workbench/dist/index.html || die "missing workbench dist"
test -f apps/web/dist/index.html || die "missing web dist"

log "stage product IDE at / (workbench host)"
cp apps/workbench/dist/index.html "${STAGE}/"
cp apps/workbench/dist/bootstrap.js "${STAGE}/"
# Product seed: ensure browser-mode capabilities for static production hosts
if [[ -f apps/workbench/dist/product.json ]]; then
  node --input-type=module <<'NODE'
import fs from 'node:fs';
const p = JSON.parse(fs.readFileSync('apps/workbench/dist/product.json', 'utf8'));
p.zcodeMode = p.zcodeMode || 'browser';
p.zcodeCapabilities = p.zcodeCapabilities || {
  terminal: false,
  browserGit: true,
  search: 'client',
};
// Never leave a remoteAuthority baked into static product for CDN
delete p.remoteAuthority;
if (!p.folderUri) {
  p.folderUri = { scheme: 'zcode-opfs', path: '/workspace/default' };
}
fs.writeFileSync('deploy/cloudflare/site/dist/product.json', JSON.stringify(p, null, 2));
NODE
fi

log "stage /extensions (zcode-* package.json + dist only, no node_modules)"
for name in zcode-browser-fs zcode-git zcode-diagnostics; do
  src="${ROOT}/extensions/${name}"
  dst="${STAGE}/extensions/${name}"
  mkdir -p "${dst}/dist/web"
  cp "${src}/package.json" "${dst}/"
  if [[ -f "${src}/dist/web/extension.js" ]]; then
    cp "${src}/dist/web/extension.js" "${dst}/dist/web/"
  else
    die "missing ${src}/dist/web/extension.js — build failed?"
  fi
done

stage_vscode_tree() {
  local src="$1"
  local label="$2"
  log "stage /vscode from ${label} (${src})"
  mkdir -p "${STAGE}/vscode"
  # Prefer out/ layout; copy without source maps to stay lean
  if [[ -d "${src}/out" ]]; then
    (
      cd "${src}"
      # copy everything except maps
      tar -cf - --exclude='*.map' --exclude='.DS_Store' . | tar -xf - -C "${STAGE}/vscode"
    )
  else
    die "vscode tree missing out/: ${src}"
  fi
}

tree_ok_for_pages() {
  local dir="$1"
  local bad
  bad="$(find "${dir}" -type f ! -name '*.map' -size +"${MAX_FILE_BYTES}c" 2>/dev/null | head -5 || true)"
  if [[ -n "${bad}" ]]; then
    log "tree has files >25MiB (Pages limit):"
    echo "${bad}"
    return 1
  fi
  return 0
}

if [[ -n "${ZCODE_CF_VSCODE_WEB_DIR:-}" ]]; then
  stage_vscode_tree "${ZCODE_CF_VSCODE_WEB_DIR}" "ZCODE_CF_VSCODE_WEB_DIR"
  tree_ok_for_pages "${STAGE}/vscode" || die "ZCODE_CF_VSCODE_WEB_DIR exceeds Pages 25MiB file limit"
elif [[ -f dist/vscode-web/out/vs/loader.js ]] && tree_ok_for_pages dist/vscode-web; then
  stage_vscode_tree "${ROOT}/dist/vscode-web" "dist/vscode-web (Pages-safe)"
elif [[ -f dist/vscode-web/out/vs/workbench/workbench.web.main.internal.js ]]; then
  log "owned esbuild tree exceeds Pages 25MiB/file — staging dogfood vscode-web@${DOGFOOD_VERSION} for CDN"
  TMP="$(mktemp -d)"
  trap 'rm -rf "${TMP}"' EXIT
  curl -fsSL -o "${TMP}/vscode-web.tgz" \
    "https://registry.npmjs.org/vscode-web/-/vscode-web-${DOGFOOD_VERSION}.tgz"
  tar -xzf "${TMP}/vscode-web.tgz" -C "${TMP}"
  stage_vscode_tree "${TMP}/package/dist" "dogfood-npm ${DOGFOOD_VERSION}"
  tree_ok_for_pages "${STAGE}/vscode" || die "dogfood tree still exceeds Pages limits"
  cat > "${STAGE}/vscode/.zcode-vscode-web.json" <<EOF
{
  "source": "dogfood-npm",
  "version": "${DOGFOOD_VERSION}",
  "note": "Cloudflare Pages uses dogfood AMD when owned esbuild bundle >25MiB",
  "stagedAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
EOF
else
  log "no staged vscode-web — fetching dogfood ${DOGFOOD_VERSION}"
  TMP="$(mktemp -d)"
  trap 'rm -rf "${TMP}"' EXIT
  curl -fsSL -o "${TMP}/vscode-web.tgz" \
    "https://registry.npmjs.org/vscode-web/-/vscode-web-${DOGFOOD_VERSION}.tgz"
  tar -xzf "${TMP}/vscode-web.tgz" -C "${TMP}"
  stage_vscode_tree "${TMP}/package/dist" "dogfood-npm ${DOGFOOD_VERSION}"
fi

if [[ ! -f "${STAGE}/vscode/out/vs/loader.js" ]] \
  && [[ ! -f "${STAGE}/vscode/out/vs/workbench/workbench.web.main.internal.js" ]]; then
  die "staged /vscode missing loader.js and workbench bundle"
fi

if [[ "${SKIP_DEBUG_SPA}" != "1" ]]; then
  log "stage debug SPA at /debug/ (not product homepage)"
  mkdir -p "${STAGE}/debug"
  cp -R apps/web/dist/. "${STAGE}/debug/"
  # SPA assets are relative; fine under /debug/
else
  log "skip debug SPA (ZCODE_CF_SKIP_DEBUG_SPA=1)"
fi

# Pages routing: do NOT blanket-rewrite /* to index (would break /vscode asset 404s).
# Only SPA client routes under /debug.
cat > "${STAGE}/_redirects" <<'EOF'
/debug/*   /debug/index.html   200
EOF

# Run Pages Functions only for git-proxy — all other paths are pure static assets.
# Without this, the Functions worker can SPA-fallback missing files to index.html
# (false-positive "owned" layout detection and broken production IDE).
cat > "${STAGE}/_routes.json" <<'EOF'
{
  "version": 1,
  "include": ["/git-proxy", "/git-proxy/*"],
  "exclude": []
}
EOF

# Security headers; allow VS Code web workers / wasm / Open VSX in browser mode.
cat > "${STAGE}/_headers" <<'EOF'
/*
  X-Content-Type-Options: nosniff
  Referrer-Policy: no-referrer
  Cross-Origin-Opener-Policy: same-origin-allow-popups
  Content-Security-Policy: default-src 'self'; script-src 'self' 'unsafe-eval' 'unsafe-inline' blob:; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; font-src 'self' data:; connect-src 'self' https: wss: blob:; worker-src 'self' blob:; frame-src 'self' https:; object-src 'none'; base-uri 'self'

/vscode/*
  Cache-Control: public, max-age=86400, immutable

/bootstrap.js
  Cache-Control: no-store

/product.json
  Cache-Control: no-store
EOF

log "staged tree summary"
du -sh "${STAGE}" "${STAGE}/vscode" "${STAGE}/extensions" "${STAGE}/debug" 2>/dev/null || true
# Portable byte size check (BSD/GNU find: suffix c = bytes)
oversized="$(find "${STAGE}" -type f ! -name '*.map' -size +"${MAX_FILE_BYTES}c" 2>/dev/null || true)"
if [[ -n "${oversized}" ]]; then
  echo "${oversized}"
  die "still have files >25MiB (Cloudflare Pages limit)"
fi
echo "files: $(find "${STAGE}" -type f | wc -l)"

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
if ! npx --yes wrangler pages project list 2>/dev/null | grep -qE "(^| )${PROJECT_NAME}( |$)"; then
  npx --yes wrangler pages project create "${PROJECT_NAME}" --production-branch "${BRANCH}" || true
fi

log "deploy Pages project ${PROJECT_NAME} (branch=${BRANCH})"
(
  cd "${SITE}"
  npx --yes wrangler pages deploy dist \
    --project-name "${PROJECT_NAME}" \
    --branch "${BRANCH}" \
    --commit-dirty=true
)

log "done"
cat <<EOF

Product IDE (homepage):  https://zcode-69r.pages.dev/
  (or the deployment URL printed above)

Debug SPA (optional):    https://zcode-69r.pages.dev/debug/
Git proxy healthz:       https://zcode-69r.pages.dev/git-proxy/healthz

Notes:
  - Homepage is VS Code Web (browser mode), not the debug SPA.
  - Owned 1.129 esbuild bundle may exceed Pages 25MiB/file; CDN uses dogfood AMD until split.
  - Remote REH mode still needs self-host (zcode serve / Docker).
EOF
