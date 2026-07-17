#!/usr/bin/env bash
# Stage a dogfood VS Code Web static tree for /ide.
#
# Default: third-party npm package `vscode-web` (Microsoft web compile packaged for browsers).
# This is **dogfood**, not the long-term owned build from vendor/vscode (see build-web.sh / M0).
# Owned builds (gulp vscode-web) replace this tree when present at vendor/vscode/.build/vscode-web.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT="${ROOT}/dist/vscode-web"
VERSION="${VSCODE_WEB_NPM_VERSION:-1.91.1}"
TARBALL_URL="${VSCODE_WEB_TARBALL_URL:-https://registry.npmjs.org/vscode-web/-/vscode-web-${VERSION}.tgz}"

log() { printf '==> %s\n' "$*"; }
die() { echo "error: $*" >&2; exit 1; }

# Keep already-staged owned tree (do not clobber with dogfood npm)
if [[ -f "${OUT}/.zcode-vscode-web.json" ]] \
  && grep -q '"source": "owned"' "${OUT}/.zcode-vscode-web.json" 2>/dev/null \
  && { [[ -f "${OUT}/out/vs/workbench/workbench.web.main.internal.js" ]] \
    || [[ -f "${OUT}/out/vs/loader.js" ]]; }; then
  log "Keeping existing owned dist/vscode-web"
  exit 0
fi

# Prefer owned gulp/esbuild output if the monorepo already built it
OWNED_CANDIDATES=(
  "${ROOT}/vendor/vscode/.build/vscode-web"
  "${ROOT}/vendor/vscode/out-vscode-web"
  "${ROOT}/vscode-web"
)
for c in "${OWNED_CANDIDATES[@]}"; do
  if [[ -d "${c}/out/vs/workbench" ]] || [[ -d "${c}/vs/workbench" ]]; then
    log "Staging OWNED vscode-web from ${c}"
    rm -rf "${OUT}"
    mkdir -p "${OUT}"
    if [[ -d "${c}/out/vs" ]]; then
      cp -R "${c}/." "${OUT}/"
    else
      mkdir -p "${OUT}/out"
      cp -R "${c}/." "${OUT}/out/"
    fi
    cat > "${OUT}/.zcode-vscode-web.json" <<EOF
{
  "source": "owned",
  "path": "${c}",
  "vscodeCommit": "$(cd "${ROOT}/vendor/vscode" 2>/dev/null && git rev-parse HEAD || echo unknown)",
  "stagedAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
EOF
    log "Staged owned build → dist/vscode-web"
    exit 0
  fi
done

log "Fetching dogfood vscode-web@${VERSION} (npm)"
log "For production, build owned assets: docs/building-vscode.md + gulp vscode-web"

TMP="$(mktemp -d)"
trap 'rm -rf "${TMP}"' EXIT

curl -fsSL -o "${TMP}/vscode-web.tgz" "${TARBALL_URL}"
tar -xzf "${TMP}/vscode-web.tgz" -C "${TMP}"

SRC="${TMP}/package/dist"
[[ -d "${SRC}/out/vs" ]] || die "unexpected tarball layout (missing out/vs)"

rm -rf "${OUT}"
mkdir -p "${OUT}"
cp -R "${SRC}/." "${OUT}/"

# product.json placeholder (apps/workbench overwrites with ZCode product at serve time)
if [[ ! -f "${OUT}/product.json" ]]; then
  cp "${ROOT}/product/product.json" "${OUT}/product.json" 2>/dev/null || true
fi

cat > "${OUT}/.zcode-vscode-web.json" <<EOF
{
  "source": "dogfood-npm",
  "package": "vscode-web",
  "version": "${VERSION}",
  "note": "Dogfood only — replace with owned microsoft/vscode gulp vscode-web for GA",
  "stagedAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
EOF

log "Staged dogfood vscode-web@${VERSION} → dist/vscode-web"
log "Serve via: zcode web  (routes /vscode/* and /ide)"
