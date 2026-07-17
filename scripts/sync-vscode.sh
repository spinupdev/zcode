#!/usr/bin/env bash
# Initialize/update vendor/vscode submodule and apply quilt patches.
# Integration model: code-server-style submodule + quilt (not OpenVSCode in-tree fork).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VSCODE_DIR="${ROOT}/vendor/vscode"
PATCHES_DIR="${ROOT}/patches"
SERIES_FILE="${PATCHES_DIR}/series"

cd "${ROOT}"

if [[ ! -d "${VSCODE_DIR}" ]]; then
  echo "error: vendor/vscode missing. Run scripts/add-vscode-submodule.sh first." >&2
  exit 1
fi

if [[ -f .gitmodules ]] && grep -q 'vendor/vscode' .gitmodules 2>/dev/null; then
  echo "==> Updating vscode submodule (if registered)"
  # Shallow-friendly: do not force deep fetch
  git submodule update --init --depth 1 vendor/vscode 2>/dev/null || true
fi

if [[ ! -d "${VSCODE_DIR}/.git" && ! -f "${VSCODE_DIR}/.git" ]]; then
  echo "error: vendor/vscode is not a git checkout" >&2
  exit 1
fi

echo "==> vscode at $(cd "${VSCODE_DIR}" && git rev-parse HEAD) ($(cd "${VSCODE_DIR}" && git describe --tags --always 2>/dev/null || echo unknown))"

# Collect non-comment, non-empty series entries
mapfile -t PATCHES < <(grep -vE '^\s*(#|$)' "${SERIES_FILE}" 2>/dev/null || true)

if [[ ${#PATCHES[@]} -eq 0 ]]; then
  echo "==> No patches in patches/series — clean tree OK"
  exit 0
fi

if command -v quilt >/dev/null 2>&1; then
  echo "==> Applying ${#PATCHES[@]} patch(es) with quilt"
  export QUILT_PATCHES="${PATCHES_DIR}"
  (
    cd "${VSCODE_DIR}"
    export QUILT_PATCHES="${PATCHES_DIR}"
    quilt push -a
  )
else
  echo "==> quilt not found; applying patches with git apply"
  echo "    Install quilt for the supported workflow: brew install quilt / apt install quilt"
  cd "${VSCODE_DIR}"
  for p in "${PATCHES[@]}"; do
    patch_path="${PATCHES_DIR}/${p}"
    if [[ ! -f "${patch_path}" ]]; then
      echo "error: missing patch ${patch_path}" >&2
      exit 1
    fi
    echo "  apply ${p}"
    git apply --check "${patch_path}"
    git apply "${patch_path}"
  done
fi

echo "==> sync-vscode complete"
