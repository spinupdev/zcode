#!/usr/bin/env bash
# Fast local smoke: monorepo build/test + vscode patch apply + build script checks.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT}"

export PATH="/opt/homebrew/bin:${PATH}"

log() { printf '==> %s\n' "$*"; }

log "pnpm build"
pnpm build

log "pnpm test"
pnpm test

log "sync-vscode (patches)"
bash scripts/sync-vscode.sh

log "build-server --check"
bash scripts/build-server.sh --check

log "build-web --check"
bash scripts/build-web.sh --check

log "no test-web in release paths"
bash scripts/check-no-test-web-in-release.sh

log "smoke OK"
