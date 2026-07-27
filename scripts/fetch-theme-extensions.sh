#!/usr/bin/env bash
# Fetch marketplace extensions used as ZCode workbench defaults + extra language packs.
#
# Themes / icons:
#   vscode-icons-team.vscode-icons  → extensions/vscode-icons
#   GitHub.github-vscode-theme      → extensions/github-vscode-theme
#
# Extra language TextMate (browser-safe, no native LSP):
#   4ops.terraform                  → extensions/terraform
#   bbenoist.Nix                    → extensions/nix
#
# Sources: Open VSX (same gallery as product.json). Pure contribution assets;
# no monorepo build step required after extract.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT="${ROOT}/extensions"
CACHE="${ROOT}/.cache/vsix"
FORCE="${ZCODE_FETCH_THEMES_FORCE:-0}"

# Pin versions for reproducible installs (bump deliberately).
VSCODE_ICONS_PUBLISHER="vscode-icons-team"
VSCODE_ICONS_NAME="vscode-icons"
VSCODE_ICONS_VERSION="${ZCODE_VSCODE_ICONS_VERSION:-12.19.0}"

GITHUB_THEME_PUBLISHER="GitHub"
GITHUB_THEME_NAME="github-vscode-theme"
GITHUB_THEME_VERSION="${ZCODE_GITHUB_THEME_VERSION:-6.3.5}"

# Lightweight TextMate-only (no main/browser required)
TERRAFORM_PUBLISHER="4ops"
TERRAFORM_NAME="terraform"
TERRAFORM_VERSION="${ZCODE_TERRAFORM_LANG_VERSION:-0.2.1}"

NIX_PUBLISHER="bbenoist"
NIX_NAME="Nix"
NIX_VERSION="${ZCODE_NIX_LANG_VERSION:-1.0.1}"

log() { printf '==> %s\n' "$*"; }
die() { echo "error: $*" >&2; exit 1; }

command -v curl >/dev/null || die "curl required"
command -v unzip >/dev/null || die "unzip required"

mkdir -p "${CACHE}" "${OUT}"

openvsx_vsix_url() {
  local publisher="$1" name="$2" version="$3"
  echo "https://open-vsx.org/api/${publisher}/${name}/${version}/file/${publisher}.${name}-${version}.vsix"
}

# Strip runtime/dev deps so pnpm workspace never tries to install marketplace deps.
# Theme/icon/grammar contributions only need package.json + assets.
sanitize_package_json() {
  local pkg="$1"
  node -e '
const fs = require("fs");
const pkg = process.argv[1];
const p = JSON.parse(fs.readFileSync(pkg, "utf8"));
delete p.dependencies;
delete p.devDependencies;
delete p.scripts;
delete p.optionalDependencies;
// Prefer browser entry for web EH when both exist
if (p.browser && p.main) {
  /* keep both — VS Code web uses browser */
}
fs.writeFileSync(pkg, JSON.stringify(p, null, 2) + "\n");
' "${pkg}"
}

extract_vsix() {
  local publisher="$1" name="$2" version="$3" dest_name="$4"
  local dest="${OUT}/${dest_name}"
  local marker="${dest}/.zcode-fetched-version"
  local vsix="${CACHE}/${publisher}.${name}-${version}.vsix"
  local url
  url="$(openvsx_vsix_url "${publisher}" "${name}" "${version}")"

  if [[ "${FORCE}" != "1" && -f "${marker}" && "$(cat "${marker}")" == "${version}" ]]; then
    if [[ -f "${dest}/package.json" ]]; then
      log "${dest_name}@${version} already present (set ZCODE_FETCH_THEMES_FORCE=1 to re-fetch)"
      return 0
    fi
  fi

  if [[ ! -f "${vsix}" ]]; then
    log "Downloading ${publisher}.${name}@${version}"
    curl -fsSL --retry 3 --retry-delay 1 -o "${vsix}.partial" "${url}"
    mv "${vsix}.partial" "${vsix}"
  else
    log "Using cached VSIX ${vsix}"
  fi

  local tmp
  tmp="$(mktemp -d "${TMPDIR:-/tmp}/zcode-vsix.XXXXXX")"
  # shellcheck disable=SC2064
  trap "rm -rf '${tmp}'" RETURN

  unzip -q -o "${vsix}" -d "${tmp}"
  [[ -f "${tmp}/extension/package.json" ]] || die "invalid VSIX (no extension/package.json): ${vsix}"

  rm -rf "${dest}"
  mkdir -p "${dest}"
  if command -v rsync >/dev/null; then
    rsync -a --delete "${tmp}/extension/" "${dest}/"
  else
    cp -R "${tmp}/extension/." "${dest}/"
  fi

  sanitize_package_json "${dest}/package.json"
  printf '%s\n' "${version}" >"${marker}"

  cat >"${dest}/.zcode-source.json" <<EOF
{
  "publisher": "${publisher}",
  "name": "${name}",
  "version": "${version}",
  "gallery": "open-vsx",
  "itemName": "${publisher}.${name}",
  "fetchedAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
EOF

  log "Staged ${dest_name}@${version} → ${dest}"
}

extract_vsix "${VSCODE_ICONS_PUBLISHER}" "${VSCODE_ICONS_NAME}" "${VSCODE_ICONS_VERSION}" "vscode-icons"
extract_vsix "${GITHUB_THEME_PUBLISHER}" "${GITHUB_THEME_NAME}" "${GITHUB_THEME_VERSION}" "github-vscode-theme"
extract_vsix "${TERRAFORM_PUBLISHER}" "${TERRAFORM_NAME}" "${TERRAFORM_VERSION}" "terraform"
extract_vsix "${NIX_PUBLISHER}" "${NIX_NAME}" "${NIX_VERSION}" "nix"

# Sanity
[[ -f "${OUT}/vscode-icons/package.json" ]] || die "vscode-icons missing package.json"
[[ -f "${OUT}/github-vscode-theme/package.json" ]] || die "github-vscode-theme missing package.json"
[[ -f "${OUT}/terraform/package.json" ]] || die "terraform language pack missing package.json"
[[ -f "${OUT}/nix/package.json" ]] || die "nix language pack missing package.json"
if ! grep -q 'vscode-icons' "${OUT}/vscode-icons/package.json"; then
  die "vscode-icons package.json does not look like the icon theme extension"
fi
if ! grep -q 'GitHub Dark Default' "${OUT}/github-vscode-theme/package.json"; then
  die "github-vscode-theme package.json missing GitHub Dark Default"
fi
if ! grep -qE '"tf"|"terraform"' "${OUT}/terraform/package.json"; then
  die "terraform pack missing tf language contribution"
fi
if ! grep -q '"nix"' "${OUT}/nix/package.json"; then
  die "nix pack missing nix language contribution"
fi

log "Ready: icons=vscode-icons theme=GitHub languages=terraform,nix"
