#!/usr/bin/env bash
# ZCode local dev — full setup + serve in one command.
#
#   pnpm dev
#
# Does (in order):
#   1. pnpm install (if node_modules missing / lockfile newer)
#   2. Stage vscode-web (+ oniguruma WASM / themes when missing)
#   3. Build monorepo (packages, apps, zcode-* extensions)
#   4. Start product IDE with COI for WebContainers
#
# Env:
#   PORT=5000                 listen port
#   ZCODE_COI=1               cross-origin isolation (default on)
#   ZCODE_DEV_SKIP_INSTALL=1  skip pnpm install
#   ZCODE_DEV_SKIP_BUILD=1    skip builds (restart only)
#   ZCODE_DEV_SKIP_FETCH=1    skip vscode-web / theme staging
#   ZCODE_DEV_FETCH=1         force re-fetch vscode-web + themes
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

PORT="${PORT:-5000}"
export ZCODE_COI="${ZCODE_COI:-1}"
export NODE_ENV=development

log() { printf '==> %s\n' "$*"; }
die() { echo "error: $*" >&2; exit 1; }

need_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "required command not found: $1"
}

need_cmd pnpm
need_cmd node
need_cmd bash

log "ZCode dev setup (port ${PORT}, ZCODE_COI=${ZCODE_COI})"

# ── 1. Dependencies ──────────────────────────────────────────────────────────
need_install=0
if [[ "${ZCODE_DEV_SKIP_INSTALL:-0}" != "1" ]]; then
  if [[ ! -d node_modules ]]; then
    need_install=1
  elif [[ -f pnpm-lock.yaml ]] && [[ pnpm-lock.yaml -nt node_modules ]]; then
    need_install=1
  elif [[ package.json -nt node_modules ]]; then
    need_install=1
  fi
  if [[ "$need_install" == "1" ]]; then
    log "pnpm install"
    pnpm install
  else
    log "pnpm install (up to date)"
  fi
else
  log "skip install (ZCODE_DEV_SKIP_INSTALL=1)"
fi

# ── 2. VS Code Web static tree + themes ──────────────────────────────────────
vscode_ok() {
  [[ -d dist/vscode-web/out ]] \
    && { [[ -f dist/vscode-web/out/vs/loader.js ]] \
      || [[ -f dist/vscode-web/out/vs/workbench/workbench.web.main.internal.js ]] \
      || [[ -f dist/vscode-web/out/vs/workbench/workbench.web.main.js ]]; }
}

onig_ok() {
  [[ -f dist/vscode-web/node_modules/vscode-oniguruma/release/onig.wasm ]]
}

themes_ok() {
  [[ -d extensions/vscode-icons ]] && [[ -d extensions/github-vscode-theme ]]
}

if [[ "${ZCODE_DEV_SKIP_FETCH:-0}" != "1" ]]; then
  if [[ "${ZCODE_DEV_FETCH:-0}" == "1" ]] || ! vscode_ok; then
    log "fetch / stage vscode-web"
    bash scripts/fetch-vscode-web.sh
  else
    log "vscode-web already staged"
  fi

  # TextMate WASM (syntax highlighting) — stage even when dogfood tree exists
  if ! onig_ok && [[ -x scripts/stage-vscode-web-node-modules.sh ]]; then
    log "stage vscode-web node_modules (oniguruma WASM)"
    bash scripts/stage-vscode-web-node-modules.sh dist/vscode-web || true
  fi

  if [[ "${ZCODE_DEV_FETCH:-0}" == "1" ]] || ! themes_ok; then
    log "fetch theme / icon extensions"
    bash scripts/fetch-theme-extensions.sh || log "WARN: theme fetch failed (IDE still runs with fallbacks)"
  else
    log "themes already staged"
  fi
else
  log "skip fetch (ZCODE_DEV_SKIP_FETCH=1)"
fi

vscode_ok || die "vscode-web not available under dist/vscode-web — check scripts/fetch-vscode-web.sh"

# ── 3. Build everything the IDE needs ────────────────────────────────────────
if [[ "${ZCODE_DEV_SKIP_BUILD:-0}" != "1" ]]; then
  log "build monorepo (turbo)"
  # Full workspace build: protocol → server/cli → workbench/web → zcode-* extensions
  pnpm exec turbo run build \
    --filter=@zcode/cli... \
    --filter=@zcode/web... \
    --filter=@zcode/workbench... \
    --filter=zcode-browser-fs... \
    --filter=zcode-git... \
    --filter=zcode-diagnostics... \
    --filter=zcode-runtime-core... \
    --filter=zcode-runtime-python... \
    --filter=zcode-runtime-node... \
    --filter=zcode-runtime-remote... \
    --filter=zcode-remote... \
    --filter=@zcode/shell... \
    --filter=@zcode/browser-agent...
else
  log "skip build (ZCODE_DEV_SKIP_BUILD=1)"
fi

CLI="apps/cli/dist/cli.js"
[[ -f "$CLI" ]] || die "missing ${CLI} — build failed; retry without ZCODE_DEV_SKIP_BUILD"
[[ -d apps/web/dist ]] || die "missing apps/web/dist — @zcode/web build failed"
[[ -d apps/workbench/dist ]] || die "missing apps/workbench/dist — @zcode/workbench build failed"

# Runtime extension bundles (shells)
for ext in \
  zcode-browser-fs \
  zcode-git \
  zcode-runtime-core \
  zcode-runtime-python \
  zcode-runtime-node
do
  if [[ ! -f "extensions/${ext}/dist/web/extension.js" ]]; then
    log "WARN: extensions/${ext}/dist/web/extension.js missing — shell/FS may not load"
  fi
done

# ── 4. Serve ─────────────────────────────────────────────────────────────────
echo ""
echo "  ┌─────────────────────────────────────────────────────────┐"
echo "  │  Product IDE   http://127.0.0.1:${PORT}/"
echo "  │  Debug SPA     http://127.0.0.1:${PORT}/debug/"
echo "  │  Git proxy     http://127.0.0.1:${PORT}/git-proxy/healthz"
echo "  │  Shells        Cmd+Shift+P → ZCode: Open Browser Shell  │"
echo "  │  COI           ZCODE_COI=${ZCODE_COI} (WebContainer / SharedArrayBuffer) │"
echo "  └─────────────────────────────────────────────────────────┘"
echo ""

exec node "$CLI" web --dir apps/web/dist --port "$PORT" --spa-debug
