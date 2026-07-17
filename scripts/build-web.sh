#!/usr/bin/env bash
# Compile / package owned VS Code Web assets from vendor/vscode (M0d).
# Production staging: dist/vscode-web (also preferred by scripts/fetch-vscode-web.sh).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VSCODE="${ROOT}/vendor/vscode"
OUT_DIR="${ROOT}/dist/vscode-web"
NODE_OPTIONS="${NODE_OPTIONS:---max-old-space-size=8192}"
export NODE_OPTIONS

CHECK_ONLY=0
DEPS_ONLY=0
COMPILE_ONLY=0
PACKAGE=0
SPIKE=0

usage() {
  cat <<'EOF'
Usage: scripts/build-web.sh [options]

  --check          Verify prerequisites (node major, vendor, disk) and exit
  --deps-only      Install vendor/vscode npm deps only
  --compile-only   Only gulp compile-web
  --package        Full product package: gulp vscode-web → stage dist/vscode-web
  --spike          Document-friendly: list gulp tasks + node version matrix hints
  -h, --help

Env:
  ZCODE_SKIP_SYNC=1     skip quilt sync
  NODE_OPTIONS          default --max-old-space-size=8192

Node: vendor/vscode .nvmrc expects Node 24.x for full builds.
Dogfood fallback (no owned build): ./scripts/fetch-vscode-web.sh

Note: @vscode/test-web is for extension unit tests only — never stage it as product.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --check) CHECK_ONLY=1; shift ;;
    --deps-only) DEPS_ONLY=1; shift ;;
    --compile-only) COMPILE_ONLY=1; shift ;;
    --package) PACKAGE=1; shift ;;
    --spike) SPIKE=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "unknown arg: $1" >&2; usage; exit 2 ;;
  esac
done

log() { printf '==> %s\n' "$*"; }
die() { echo "error: $*" >&2; exit 1; }
warn() { echo "warning: $*" >&2; }

need_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "missing required command: $1"
}

node_major() {
  node -p "process.versions.node.split('.')[0]"
}

check_disk() {
  local avail_kb
  avail_kb=$(df -k "${ROOT}" | awk 'NR==2 {print $4}')
  if [[ -n "${avail_kb}" && "${avail_kb}" -lt 20971520 ]]; then
    warn "less than ~20GB free — full vscode-web package often needs 30–40GB free"
  fi
}

check_prereqs() {
  need_cmd node
  need_cmd npm
  need_cmd git
  [[ -d "${VSCODE}" ]] || die "vendor/vscode missing — run scripts/add-vscode-submodule.sh"
  [[ -f "${VSCODE}/package.json" ]] || die "vendor/vscode/package.json missing"

  local major expected
  major="$(node_major)"
  expected="$(tr -d '[:space:]' < "${VSCODE}/.nvmrc" 2>/dev/null | cut -d. -f1 || echo 24)"
  log "node $(node -v) (major=${major}) npm $(npm -v)"
  log "vscode $(cd "${VSCODE}" && git rev-parse --short HEAD) ($(cd "${VSCODE}" && git describe --tags --always 2>/dev/null || echo unknown))"
  log "vendor .nvmrc expects Node ${expected}.x"
  if [[ "${major}" != "${expected}" ]]; then
    warn "Node major ${major} != expected ${expected} — use nvm/fnm: nvm install ${expected} && nvm use"
    warn "Full gulp vscode-web may fail or produce wrong output on mismatched Node"
  fi
  check_disk
}

install_deps() {
  log "Installing npm deps in vendor/vscode (isolated from monorepo pnpm)"
  (
    cd "${VSCODE}"
    if [[ -f package-lock.json ]]; then
      npm ci --no-audit --no-fund
    else
      npm install --no-audit --no-fund
    fi
  )
}

list_spike() {
  log "M0d spike inventory"
  check_prereqs
  if [[ -d "${VSCODE}/node_modules" ]]; then
    log "node_modules present"
  else
    warn "node_modules missing — run: ./scripts/build-web.sh --deps-only"
  fi
  if [[ -x "${VSCODE}/node_modules/.bin/gulp" ]] || [[ -f "${VSCODE}/node_modules/gulp/bin/gulp.js" ]]; then
    log "Listing gulp tasks matching *web* (may take a few seconds)"
    (
      cd "${VSCODE}"
      # Prefer npm run gulp if scripted
      if npm run -s gulp -- --tasks-simple 2>/dev/null | rg -i 'web|vscode-web' | head -40; then
        :
      else
        npx --no-install gulp --tasks-simple 2>/dev/null | rg -i 'web|vscode-web' | head -40 || true
      fi
    ) || warn "could not list gulp tasks (deps incomplete?)"
  fi
  cat <<'EOF'

Recommended owned-web sequence (Node 24, 30GB+ free disk):

  nvm install 24 && nvm use        # matches vendor/vscode/.nvmrc
  ./scripts/build-web.sh --deps-only
  ./scripts/build-web.sh --compile-only   # gulp compile-web
  ./scripts/build-web.sh --package        # gulp vscode-web + stage dist/vscode-web

Fallback dogfood (no pin alignment):

  ./scripts/fetch-vscode-web.sh           # vscode-web@1.91.1 npm package

Gulp tasks of interest (1.129):
  compile-web
  esbuild-vscode-web / esbuild-vscode-web-min
  vscode-web / vscode-web-ci / vscode-web-min
EOF
}

compile_web() {
  log "gulp compile-web (long-running)"
  (
    cd "${VSCODE}"
    npm run gulp compile-web
  )
}

package_web() {
  log "gulp vscode-web (product package — long-running, large disk)"
  (
    cd "${VSCODE}"
    # Primary product task; falls back to esbuild bundle path if needed
    if npm run gulp vscode-web; then
      :
    else
      warn "gulp vscode-web failed — trying esbuild-vscode-web"
      npm run gulp esbuild-vscode-web
    fi
  )

  local built=""
  local candidates=(
    "${VSCODE}/.build/vscode-web"
    "${VSCODE}/.build/vscode-web-min"
    "${VSCODE}/out-vscode-web"
    "${VSCODE}/out-vscode-web-min"
  )
  for c in "${candidates[@]}"; do
    if [[ -d "${c}/out/vs" ]] || [[ -d "${c}/out/vs/workbench" ]]; then
      built="${c}"
      break
    fi
  done
  # Some layouts use out/vs at top of .build
  if [[ -z "${built}" ]]; then
    built="$(find "${VSCODE}/.build" -maxdepth 2 -type d -name 'vscode-web*' 2>/dev/null | head -1 || true)"
  fi

  [[ -n "${built}" && -d "${built}" ]] || die "could not locate vscode-web output under vendor/vscode/.build — see docs/building-vscode.md"

  log "Staging ${built} → ${OUT_DIR}"
  rm -rf "${OUT_DIR}"
  mkdir -p "${OUT_DIR}"
  if command -v rsync >/dev/null 2>&1; then
    rsync -a "${built}/" "${OUT_DIR}/"
  else
    cp -R "${built}/." "${OUT_DIR}/"
  fi

  cat > "${OUT_DIR}/.zcode-vscode-web.json" <<EOF
{
  "source": "owned",
  "path": "${built}",
  "vscodeCommit": "$(cd "${VSCODE}" && git rev-parse HEAD)",
  "vscodeTag": "$(cd "${VSCODE}" && git describe --tags --always 2>/dev/null || echo unknown)",
  "builtAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "node": "$(node -v)"
}
EOF
  # Marker for monorepo tooling
  mkdir -p "${ROOT}/dist/web"
  cp "${OUT_DIR}/.zcode-vscode-web.json" "${ROOT}/dist/web/.zcode-build.json"
  log "Owned vscode-web staged at dist/vscode-web"
}

main() {
  if [[ "${SPIKE}" -eq 1 ]]; then
    list_spike
    exit 0
  fi

  check_prereqs

  if [[ "${CHECK_ONLY}" -eq 1 ]]; then
    log "Prerequisites OK"
    exit 0
  fi

  if [[ "${ZCODE_SKIP_SYNC:-0}" != "1" ]]; then
    log "Syncing vscode + patches"
    bash "${ROOT}/scripts/sync-vscode.sh"
  fi

  if [[ ! -d "${VSCODE}/node_modules" ]] || [[ "${DEPS_ONLY}" -eq 1 ]]; then
    install_deps
  fi
  if [[ "${DEPS_ONLY}" -eq 1 ]]; then
    log "Deps ready"
    exit 0
  fi

  if [[ "${PACKAGE}" -eq 1 ]]; then
    # Package task typically depends on compile; run full vscode-web
    package_web
    log "build-web --package complete"
    exit 0
  fi

  # Default / --compile-only
  compile_web
  mkdir -p "${ROOT}/dist/web"
  cat > "${ROOT}/dist/web/.zcode-build.json" <<EOF
{
  "kind": "vscode-web-compile",
  "vscodeCommit": "$(cd "${VSCODE}" && git rev-parse HEAD)",
  "note": "Sources compiled (compile-web); run --package to stage product tree",
  "builtAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "node": "$(node -v)"
}
EOF
  log "compile-web finished; marker at dist/web/.zcode-build.json"
  log "Next: ./scripts/build-web.sh --package   # stages dist/vscode-web"
}

main
