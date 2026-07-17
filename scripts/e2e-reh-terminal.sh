#!/usr/bin/env bash
# R6: Playwright terminal e2e against REH via cookie proxy.
# Skips (exit 0) when dist/server REH artifact is missing unless ZCODE_E2E_REH_REQUIRED=1.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT}"
export PATH="/opt/homebrew/bin:/tmp/zcode-node24/node-v24.18.0-darwin-arm64/bin:${PATH}"

log() { printf '==> %s\n' "$*"; }
warn() { echo "warning: $*" >&2; }

MARKER="${ROOT}/dist/server/.zcode-build.json"
REQUIRED="${ZCODE_E2E_REH_REQUIRED:-0}"

has_binary() {
  local d="${ROOT}/dist/server"
  [[ -f "${d}/bin/code-server-oss" || -f "${d}/bin/code-server" || -f "${d}/server.sh" ]]
}

if [[ ! -f "${MARKER}" ]] || ! has_binary; then
  msg="No runnable REH at dist/server (marker+binary). Produce with ./scripts/build-server.sh or CI vscode-reh-build."
  if [[ "${REQUIRED}" == "1" ]]; then
    echo "error: ${msg} (ZCODE_E2E_REH_REQUIRED=1)" >&2
    exit 1
  fi
  warn "${msg}"
  warn "Skipping R6 full e2e (exit 0). Unit proxy flow still covered by pnpm --filter @zcode/server test."
  exit 0
fi

log "REH artifact present — building surfaces for serve e2e"
pnpm --filter @zcode/cli build
pnpm --filter @zcode/server build
pnpm --filter @zcode/web build
pnpm --filter zcode-browser-fs build
pnpm --filter zcode-git build
pnpm --filter @zcode/workbench build

if [[ ! -f dist/vscode-web/out/vs/loader.js ]]; then
  log "staging vscode-web (dogfood or owned)"
  bash scripts/fetch-vscode-web.sh
fi

log "install e2e deps + chromium"
pnpm install
pnpm --filter @zcode/e2e install-browsers

export ZCODE_E2E_PASSWORD="${ZCODE_E2E_PASSWORD:-zcode-e2e}"
export ZCODE_E2E_REH_PORT="${ZCODE_E2E_REH_PORT:-15020}"
export ZCODE_SPAWN_REH=1

log "run Playwright R6 suite"
pnpm --filter @zcode/e2e exec playwright test -c playwright.reh.config.ts

log "e2e-reh-terminal OK"
