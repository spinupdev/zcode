#!/usr/bin/env bash
# Stage runtime node_modules required by owned VS Code Web (esbuild/gulp).
#
# Workbench loads TextMate via dynamic AMD import:
#   FileAccess.asBrowserUri('vs/../../node_modules/vscode-oniguruma/release/onig.wasm')
# → GET /vscode/node_modules/vscode-oniguruma/release/onig.wasm
#
# Without these, language packs load but syntax stays monochrome (no tokenizer).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT="${1:-${ROOT}/dist/vscode-web}"
VSCODE="${ROOT}/vendor/vscode"

log() { printf '==> %s\n' "$*"; }
warn() { printf 'WARN: %s\n' "$*" >&2; }

# Packages the web workbench importAMDNodeModule()'s at runtime (see workbench.web.main).
REQUIRED_PKGS=(
  vscode-oniguruma
  vscode-textmate
  @vscode/iconv-lite-umd
  @vscode/tree-sitter-wasm
  jschardet
  katex
  tas-client
)

# Optional / larger — stage if present in vendor/vscode/node_modules
OPTIONAL_PKGS=(
  @xterm/xterm
  @xterm/addon-clipboard
  @xterm/addon-image
  @xterm/addon-ligatures
  @xterm/addon-progress
  @xterm/addon-search
  @xterm/addon-serialize
  @xterm/addon-unicode11
  @xterm/addon-webgl
  @microsoft/1ds-core-js
  @microsoft/1ds-post-js
  vsda
)

copy_pkg() {
  local name="$1"
  local src="${VSCODE}/node_modules/${name}"
  local dest="${OUT}/node_modules/${name}"
  if [[ ! -d "${src}" ]]; then
    return 1
  fi
  mkdir -p "$(dirname "${dest}")"
  rm -rf "${dest}"
  if command -v rsync >/dev/null 2>&1; then
    rsync -a --delete \
      --exclude 'node_modules' \
      --exclude 'src' \
      --exclude 'test' \
      --exclude '*.ts' \
      --exclude 'tsconfig*.json' \
      "${src}/" "${dest}/"
  else
    mkdir -p "${dest}"
    cp -R "${src}/." "${dest}/"
  fi
  return 0
}

if [[ ! -d "${OUT}/out" ]] && [[ ! -d "${OUT}/vs" ]]; then
  warn "no staged vscode-web at ${OUT} — skip node_modules"
  exit 0
fi

if [[ ! -d "${VSCODE}/node_modules" ]]; then
  warn "vendor/vscode/node_modules missing — cannot stage oniguruma (run ./scripts/build-web.sh --deps-only)"
  exit 0
fi

mkdir -p "${OUT}/node_modules"
missing=0
for p in "${REQUIRED_PKGS[@]}"; do
  if copy_pkg "${p}"; then
    log "staged ${p}"
  else
    warn "REQUIRED missing: vendor/vscode/node_modules/${p}"
    missing=1
  fi
done

for p in "${OPTIONAL_PKGS[@]}"; do
  if copy_pkg "${p}"; then
    log "staged optional ${p}"
  fi
done

if [[ ! -f "${OUT}/node_modules/vscode-oniguruma/release/onig.wasm" ]]; then
  warn "onig.wasm still missing under ${OUT}/node_modules/vscode-oniguruma/release/"
  exit 1
fi

log "TextMate deps ready → ${OUT}/node_modules (onig.wasm OK)"
exit "${missing}"
