#!/usr/bin/env bash
# Compile VS Code web workbench sources (path toward M0 owned web assets).
# Production staging into apps/web/dist is a later step — this is the compile entry.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VSCODE="${ROOT}/vendor/vscode"
NODE_OPTIONS="${NODE_OPTIONS:---max-old-space-size=8192}"
export NODE_OPTIONS

CHECK_ONLY=0
DEPS_ONLY=0
COMPILE_ONLY=0

usage() {
  cat <<'EOF'
Usage: scripts/build-web.sh [options]

  --check          Verify prerequisites and exit
  --deps-only      Install vendor/vscode npm deps only
  --compile-only   Only gulp compile-web (default action today)
  -h, --help

Note: @vscode/test-web is for extension unit tests / local harness only.
      Production must use OSS web build output (see docs/building-vscode.md).
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --check) CHECK_ONLY=1; shift ;;
    --deps-only) DEPS_ONLY=1; shift ;;
    --compile-only) COMPILE_ONLY=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "unknown arg: $1" >&2; usage; exit 2 ;;
  esac
done

log() { printf '==> %s\n' "$*"; }
die() { echo "error: $*" >&2; exit 1; }

[[ -d "${VSCODE}" ]] || die "vendor/vscode missing — run scripts/add-vscode-submodule.sh"
command -v node >/dev/null || die "node required"
command -v npm >/dev/null || die "npm required"

if [[ "${CHECK_ONLY}" -eq 1 ]]; then
  log "node $(node -v) npm $(npm -v)"
  log "vscode $(cd "${VSCODE}" && git rev-parse --short HEAD)"
  log "Prerequisites OK"
  exit 0
fi

if [[ "${ZCODE_SKIP_SYNC:-0}" != "1" ]]; then
  bash "${ROOT}/scripts/sync-vscode.sh"
fi

if [[ ! -d "${VSCODE}/node_modules" ]]; then
  log "Installing npm deps in vendor/vscode"
  (
    cd "${VSCODE}"
    if [[ -f package-lock.json ]]; then
      npm ci --no-audit --no-fund
    else
      npm install --no-audit --no-fund
    fi
  )
fi

if [[ "${DEPS_ONLY}" -eq 1 ]]; then
  log "Deps ready"
  exit 0
fi

log "gulp compile-web (long-running)"
(
  cd "${VSCODE}"
  npm run gulp compile-web
)

mkdir -p "${ROOT}/dist/web"
cat > "${ROOT}/dist/web/.zcode-build.json" <<EOF
{
  "kind": "vscode-web-compile",
  "vscodeCommit": "$(cd "${VSCODE}" && git rev-parse HEAD)",
  "note": "Sources compiled in vendor/vscode; full product packaging is M0",
  "builtAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
EOF

log "compile-web finished; marker at dist/web/.zcode-build.json"
log "Staging full static product into apps/web/dist is PR M0"
