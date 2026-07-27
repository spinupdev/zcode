#!/usr/bin/env bash
# Fetch marketplace extensions used by ZCode browser workbench:
#   - themes / icons (GitHub Theme, vscode-icons)
#   - extra language TextMate packs (product/extra-language-extensions.json)
#
# Sources: Open VSX. Strips npm deps so pnpm workspace stays clean.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT="${ROOT}/extensions"
CACHE="${ROOT}/.cache/vsix"
FORCE="${ZCODE_FETCH_THEMES_FORCE:-0}"
MANIFEST="${ROOT}/product/extra-language-extensions.json"

# Pin versions for themes/icons
VSCODE_ICONS_PUBLISHER="vscode-icons-team"
VSCODE_ICONS_NAME="vscode-icons"
VSCODE_ICONS_VERSION="${ZCODE_VSCODE_ICONS_VERSION:-12.19.0}"

GITHUB_THEME_PUBLISHER="GitHub"
GITHUB_THEME_NAME="github-vscode-theme"
GITHUB_THEME_VERSION="${ZCODE_GITHUB_THEME_VERSION:-6.3.5}"

log() { printf '==> %s\n' "$*"; }
warn() { printf 'WARN: %s\n' "$*" >&2; }
die() { echo "error: $*" >&2; exit 1; }

command -v curl >/dev/null || die "curl required"
command -v unzip >/dev/null || die "unzip required"
command -v node >/dev/null || die "node required"

mkdir -p "${CACHE}" "${OUT}"

openvsx_vsix_url() {
  local publisher="$1" name="$2" version="$3"
  echo "https://open-vsx.org/api/${publisher}/${name}/${version}/file/${publisher}.${name}-${version}.vsix"
}

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
      log "${dest_name}@${version} already present"
      return 0
    fi
  fi

  if [[ ! -f "${vsix}" ]]; then
    log "Downloading ${publisher}.${name}@${version}"
    if ! curl -fsSL --retry 3 --retry-delay 1 -o "${vsix}.partial" "${url}"; then
      warn "download failed: ${url}"
      rm -f "${vsix}.partial"
      return 1
    fi
    mv "${vsix}.partial" "${vsix}"
  else
    log "Using cached VSIX ${vsix}"
  fi

  local tmp
  tmp="$(mktemp -d "${TMPDIR:-/tmp}/zcode-vsix.XXXXXX")"
  # shellcheck disable=SC2064
  trap "rm -rf '${tmp}'" RETURN

  if ! unzip -q -o "${vsix}" -d "${tmp}"; then
    warn "unzip failed: ${vsix}"
    return 1
  fi
  [[ -f "${tmp}/extension/package.json" ]] || {
    warn "invalid VSIX (no extension/package.json): ${vsix}"
    return 1
  }

  rm -rf "${dest}"
  mkdir -p "${dest}"
  if command -v rsync >/dev/null; then
    rsync -a --delete \
      --exclude 'node_modules' \
      --exclude '.git' \
      "${tmp}/extension/" "${dest}/"
  else
    cp -R "${tmp}/extension/." "${dest}/"
  fi
  # Drop nested node_modules if any (LSP binary packs)
  rm -rf "${dest}/node_modules"

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

# Themes / icons
extract_vsix "${VSCODE_ICONS_PUBLISHER}" "${VSCODE_ICONS_NAME}" "${VSCODE_ICONS_VERSION}" "vscode-icons" || die "vscode-icons required"
extract_vsix "${GITHUB_THEME_PUBLISHER}" "${GITHUB_THEME_NAME}" "${GITHUB_THEME_VERSION}" "github-vscode-theme" || die "github-vscode-theme required"

# Extra languages from manifest
[[ -f "${MANIFEST}" ]] || die "missing ${MANIFEST}"

failed=0
while IFS=$'\t' read -r dest publisher name version; do
  [[ -n "${dest}" ]] || continue
  if ! extract_vsix "${publisher}" "${name}" "${version}" "${dest}"; then
    warn "skip failed pack: ${dest} (${publisher}.${name}@${version})"
    failed=$((failed + 1))
  fi
done < <(node -e '
const m = require(process.argv[1]);
for (const p of m.packs || []) {
  console.log([p.dest, p.publisher, p.name, p.version].join("\t"));
}
' "${MANIFEST}")

# Sanity themes
[[ -f "${OUT}/vscode-icons/package.json" ]] || die "vscode-icons missing package.json"
[[ -f "${OUT}/github-vscode-theme/package.json" ]] || die "github-vscode-theme missing package.json"
grep -q 'vscode-icons' "${OUT}/vscode-icons/package.json" || die "vscode-icons package.json unexpected"
grep -q 'GitHub Dark Default' "${OUT}/github-vscode-theme/package.json" || die "github theme missing GitHub Dark Default"

# Count staged language packs from manifest
staged=0
while IFS=$'\t' read -r dest _rest; do
  if [[ -f "${OUT}/${dest}/package.json" ]]; then
    staged=$((staged + 1))
  fi
done < <(node -e '
const m = require(process.argv[1]);
for (const p of m.packs || []) console.log(p.dest);
' "${MANIFEST}")

log "Ready: icons=vscode-icons theme=GitHub language-packs=${staged} (failed=${failed})"
# Non-zero only if themes missing; language pack failures are soft
exit 0
