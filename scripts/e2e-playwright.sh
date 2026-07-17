#!/usr/bin/env bash
# Playwright e2e (M3): routes + SPA clone + IDE product handoff
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT}"
export PATH="/opt/homebrew/bin:${PATH}"

log() { printf '==> %s\n' "$*"; }

log "build app surfaces"
pnpm --filter @zcode/cli build
pnpm --filter @zcode/web build
pnpm --filter zcode-browser-fs build
pnpm --filter zcode-git build
pnpm --filter @zcode/workbench build

if [[ ! -f dist/vscode-web/out/vs/loader.js ]]; then
  log "staging vscode-web (dogfood)"
  bash scripts/fetch-vscode-web.sh
fi

log "install e2e deps + chromium"
pnpm install
pnpm --filter @zcode/e2e install-browsers

log "run playwright"
pnpm --filter @zcode/e2e test

log "e2e-playwright OK"
