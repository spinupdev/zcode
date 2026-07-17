#!/usr/bin/env bash
# Build VS Code Remote Extension Host / server for ZCode.
# Isolates npm inside vendor/vscode; does not use monorepo pnpm for upstream.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VSCODE="${ROOT}/vendor/vscode"
OUT_DIR="${ROOT}/dist/server"
NODE_OPTIONS="${NODE_OPTIONS:---max-old-space-size=8192}"
export NODE_OPTIONS

CHECK_ONLY=0
DEPS_ONLY=0
COMPILE_ONLY=0
SKIP_PACKAGE=0

usage() {
  cat <<'EOF'
Usage: scripts/build-server.sh [options]

  --check          Verify prerequisites and exit
  --deps-only      Install vendor/vscode npm deps only
  --compile-only   Compile sources (gulp compile); skip REH package
  --skip-package   Same as --compile-only
  -h, --help       Show help

Env:
  ZCODE_REH_PLATFORM  linux | darwin | win32  (default: host)
  ZCODE_REH_ARCH      x64 | arm64             (default: host)
  ZCODE_SKIP_SYNC     1 to skip scripts/sync-vscode.sh
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --check) CHECK_ONLY=1; shift ;;
    --deps-only) DEPS_ONLY=1; shift ;;
    --compile-only|--skip-package) COMPILE_ONLY=1; SKIP_PACKAGE=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "unknown arg: $1" >&2; usage; exit 2 ;;
  esac
done

log() { printf '==> %s\n' "$*"; }
die() { echo "error: $*" >&2; exit 1; }

need_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "missing required command: $1"
}

detect_platform() {
  case "$(uname -s)" in
    Linux*) echo linux ;;
    Darwin*) echo darwin ;;
    MINGW*|MSYS*|CYGWIN*) echo win32 ;;
    *) die "unsupported OS: $(uname -s)" ;;
  esac
}

detect_arch() {
  case "$(uname -m)" in
    x86_64|amd64) echo x64 ;;
    arm64|aarch64) echo arm64 ;;
    *) die "unsupported arch: $(uname -m)" ;;
  esac
}

check_disk() {
  local avail_kb
  avail_kb=$(df -k "${ROOT}" | awk 'NR==2 {print $4}')
  # 20GB soft warning threshold in KB
  if [[ -n "${avail_kb}" && "${avail_kb}" -lt 20971520 ]]; then
    echo "warning: less than ~20GB free on $(df -h "${ROOT}" | awk 'NR==2 {print $4 " free on " $6}')" >&2
    echo "         full REH builds often need 40–64GB free" >&2
  fi
}

check_prereqs() {
  need_cmd node
  need_cmd npm
  need_cmd git
  need_cmd python3
  [[ -d "${VSCODE}" ]] || die "vendor/vscode missing — run scripts/add-vscode-submodule.sh"
  [[ -f "${VSCODE}/package.json" ]] || die "vendor/vscode/package.json missing"
  log "node $(node -v) npm $(npm -v)"
  log "vscode $(cd "${VSCODE}" && git rev-parse --short HEAD) ($(cd "${VSCODE}" && git describe --tags --always 2>/dev/null || echo unknown))"
  check_disk
}

install_deps() {
  log "Installing npm deps in vendor/vscode (isolated from monorepo pnpm)"
  # @vscode/ripgrep postinstall needs GitHub releases; 403 without token is common.
  if [[ -z "${GITHUB_TOKEN:-}" ]] && command -v gh >/dev/null 2>&1; then
    GITHUB_TOKEN="$(gh auth token 2>/dev/null || true)"
    export GITHUB_TOKEN
  fi
  if [[ -n "${GITHUB_TOKEN:-}" ]]; then
    log "GITHUB_TOKEN present for @vscode/ripgrep postinstall"
  else
    echo "warning: GITHUB_TOKEN unset — @vscode/ripgrep may 403; set token or use CI" >&2
  fi
  (
    cd "${VSCODE}"
    # Prefer ci when lockfile present for reproducibility
    if [[ -f package-lock.json ]]; then
      npm ci --no-audit --no-fund
    else
      npm install --no-audit --no-fund
    fi
  )
}

compile_sources() {
  # Prefer without-mangling: 1.129 mangler + typecheck often fails on test sources.
  log "Compiling VS Code sources (compile-build-without-mangling) — long-running"
  (
    cd "${VSCODE}"
    if npm run gulp compile-build-without-mangling; then
      :
    else
      echo "warning: without-mangling failed — trying gulp compile (dev)" >&2
      npm run gulp compile
    fi
  )
}

package_reh() {
  local platform arch task task_ci
  platform="${ZCODE_REH_PLATFORM:-$(detect_platform)}"
  arch="${ZCODE_REH_ARCH:-$(detect_arch)}"
  task="vscode-reh-${platform}-${arch}"
  task_ci="${task}-ci"

  # Full task re-runs mangled compile. Prefer: without-mangling compile (already
  # done) + extensions/media + bundle via full task only if needed; otherwise -ci
  # after manual bundle is fragile. Strategy:
  # 1) full ${task} (includes compile with mangling — may fail)
  # 2) without-mangling already done → gulp ${task_ci} needs out-vscode-reh first
  # 3) run full task but it recompiles with mangling…
  #
  # Practical path: run full ${task}; on failure try compile-build-without-mangling
  # then a series that mirrors CI after out-build exists.
  log "Packaging REH: gulp ${task} (fallback ${task_ci})"
  local used_task="${task}"
  if ! (cd "${VSCODE}" && npm run gulp "${task}"); then
    echo "warning: gulp ${task} failed — trying without-mangling + ${task_ci}" >&2
    used_task="${task_ci}"
    (
      cd "${VSCODE}"
      npm run gulp compile-build-without-mangling || true
      # Bundle REH sources into out-vscode-reh when missing
      if [[ ! -d out-vscode-reh ]]; then
        npm run gulp "minify-vscode-reh" 2>/dev/null || \
          npm run gulp -- --tasks-simple 2>/dev/null | head -1 >/dev/null
        # Best-effort: re-run full task without relying on mangler by invoking -ci
        # after ensuring out-vscode-reh via optimize bundle name patterns
        if [[ ! -d out-vscode-reh ]]; then
          # Full task series without mangling: use compile-build-without-mangling
          # then invoke internal steps by re-running ${task} often still mangles.
          # Last resort: ${task_ci} (requires out-vscode-reh).
          echo "warning: out-vscode-reh missing; ${task_ci} may produce incomplete package" >&2
        fi
      fi
      npm run gulp "${task_ci}"
    )
  fi

  # Locate output: monorepo root, vendor sibling, or .build
  local built=""
  local candidates=(
    "${ROOT}/vscode-reh-${platform}-${arch}"
    "${ROOT}/vendor/vscode-reh-${platform}-${arch}"
    "${VSCODE}/../vscode-reh-${platform}-${arch}"
    "${VSCODE}/.build/vscode-reh-${platform}-${arch}"
  )
  for c in "${candidates[@]}"; do
    if [[ -d "${c}/bin" ]] || [[ -f "${c}/server.sh" ]]; then
      built="${c}"
      break
    fi
  done
  if [[ -z "${built}" ]]; then
    built="$(find "${ROOT}" "${VSCODE}/.build" -maxdepth 2 -type d -name "vscode-reh-${platform}-${arch}*" 2>/dev/null | head -1 || true)"
  fi

  mkdir -p "${OUT_DIR}"
  if [[ -n "${built}" && -d "${built}" ]]; then
    log "Copying ${built} -> ${OUT_DIR}"
    rsync -a --delete "${built}/" "${OUT_DIR}/" 2>/dev/null || {
      rm -rf "${OUT_DIR}"
      mkdir -p "${OUT_DIR}"
      cp -R "${built}/." "${OUT_DIR}/"
    }
    cat > "${OUT_DIR}/.zcode-build.json" <<EOF
{
  "kind": "vscode-reh",
  "task": "${used_task}",
  "vscodeCommit": "$(cd "${VSCODE}" && git rev-parse HEAD)",
  "vscodeTag": "$(cd "${VSCODE}" && git describe --tags --always 2>/dev/null || echo unknown)",
  "platform": "${platform}",
  "arch": "${arch}",
  "builtAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
EOF
    if [[ ! -f "${OUT_DIR}/out/server-main.js" && ! -f "${OUT_DIR}/out/server-main.ts" ]]; then
      echo "warning: REH package may be incomplete (missing out/server-main.js)" >&2
    fi
    log "REH ready at dist/server"
    # Clean intermediate sibling package trees
    for c in "${candidates[@]}"; do
      if [[ "${c}" != "${OUT_DIR}" && -d "${c}" && "${c}" == *vscode-reh* ]]; then
        rm -rf "${c}"
      fi
    done
  else
    echo "warning: could not locate REH output directory after ${used_task}" >&2
    echo "         check vendor/vscode/.build and monorepo root for vscode-reh-*" >&2
    ls -la "${VSCODE}/.build" 2>/dev/null || true
    ls -d "${ROOT}"/vscode-reh-* "${ROOT}"/vendor/vscode-reh-* 2>/dev/null || true
    exit 1
  fi
}

main() {
  check_prereqs

  if [[ "${CHECK_ONLY}" -eq 1 ]]; then
    log "Prerequisites OK"
    local platform arch
    platform="${ZCODE_REH_PLATFORM:-$(detect_platform)}"
    arch="${ZCODE_REH_ARCH:-$(detect_arch)}"
    log "Would package: vscode-reh-${platform}-${arch}"
    exit 0
  fi

  if [[ "${ZCODE_SKIP_SYNC:-0}" != "1" ]]; then
    log "Syncing vscode + patches"
    bash "${ROOT}/scripts/sync-vscode.sh"
  fi

  install_deps
  if [[ "${DEPS_ONLY}" -eq 1 ]]; then
    log "Deps installed"
    exit 0
  fi

  compile_sources
  if [[ "${SKIP_PACKAGE}" -eq 1 || "${COMPILE_ONLY}" -eq 1 ]]; then
    log "Compile complete (--compile-only); skipping REH package"
    exit 0
  fi

  package_reh
  log "build-server complete"
}

main
