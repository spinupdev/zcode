#!/usr/bin/env bash
# Register microsoft/vscode as a shallow submodule pinned to a stable tag.
# Default pin: latest stable at kickoff (see docs/vscode-pin.md).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TAG="${VSCODE_TAG:-1.129.0}"
REPO="${VSCODE_REPO:-https://github.com/microsoft/vscode.git}"

cd "${ROOT}"

if [[ -d vendor/vscode/.git || -f vendor/vscode/.git ]]; then
  echo "vendor/vscode already present at $(cd vendor/vscode && git rev-parse HEAD)"
  exit 0
fi

mkdir -p vendor

echo "==> Cloning ${REPO} tag ${TAG} (shallow)"
# Tags work with git clone --branch; git submodule add --branch only accepts branch names.
git clone --depth 1 --branch "${TAG}" "${REPO}" vendor/vscode

SHA="$(cd vendor/vscode && git rev-parse HEAD)"
echo "Pinned commit: ${SHA}"
echo "Describe: $(cd vendor/vscode && git describe --tags --always 2>/dev/null || true)"

echo "==> Registering as git submodule"
# Absorb the existing clone as a submodule without re-cloning
git submodule add --force "${REPO}" vendor/vscode 2>/dev/null || true

# Ensure .gitmodules exists with correct path
if ! grep -q 'vendor/vscode' .gitmodules 2>/dev/null; then
  cat > .gitmodules <<EOF
[submodule "vendor/vscode"]
	path = vendor/vscode
	url = ${REPO}
EOF
fi

# Point the gitlink at the pinned SHA (submodule add may have reset checkout)
(
  cd vendor/vscode
  # Keep shallow tag tip
  if ! git rev-parse -q --verify "refs/tags/${TAG}" >/dev/null 2>&1; then
    git fetch --depth 1 origin "refs/tags/${TAG}:refs/tags/${TAG}" || true
  fi
  git checkout -q "${SHA}"
)

# Stage gitlink at the correct commit
git add .gitmodules
git update-index --add --cacheinfo "160000,${SHA},vendor/vscode" 2>/dev/null || git add vendor/vscode

echo "==> Submodule registered. Update docs/vscode-pin.md if SHA differs."
echo "    SHA=${SHA} TAG=${TAG}"
