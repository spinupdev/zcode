#!/usr/bin/env bash
# Download a CI-built Linux REH package into dist/server for local/optional e2e.
#
# Source: GitHub Actions artifact `zcode-reh-linux-x64` from workflow CI
# (workflow_dispatch heavy_build=reh | reh-and-e2e).
#
# Never commits binaries. Requires `gh` authenticated to the repo.
#
# Usage:
#   ./scripts/fetch-reh-artifact.sh
#   ./scripts/fetch-reh-artifact.sh --run-id 123456789
#   ./scripts/fetch-reh-artifact.sh --repo spinupdev/code-server
#   ZCODE_REH_RUN_ID=123 ./scripts/fetch-reh-artifact.sh
#
# After success:
#   dist/server/.zcode-build.json + bin/code-server-oss (or code-server)
#   pnpm e2e:reh
#   ZCODE_E2E_REH_REQUIRED=1 pnpm e2e:reh
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT="${ROOT}/dist/server"
ARTIFACT_NAME="${ZCODE_REH_ARTIFACT_NAME:-zcode-reh-linux-x64}"
WORKFLOW="${ZCODE_REH_WORKFLOW:-ci.yml}"
REPO="${ZCODE_REH_REPO:-}"
RUN_ID="${ZCODE_REH_RUN_ID:-}"
FORCE=0

log() { printf '==> %s\n' "$*"; }
warn() { echo "warning: $*" >&2; }
die() { echo "error: $*" >&2; exit 1; }

usage() {
  sed -n '2,20p' "$0" | sed 's/^# \{0,1\}//'
  exit 0
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --run-id) RUN_ID="${2:-}"; shift 2 ;;
    --repo) REPO="${2:-}"; shift 2 ;;
    --artifact) ARTIFACT_NAME="${2:-}"; shift 2 ;;
    --force|-f) FORCE=1; shift ;;
    -h|--help) usage ;;
    *) die "unknown arg: $1 (try --help)" ;;
  esac
done

command -v gh >/dev/null 2>&1 || die "gh CLI required (https://cli.github.com/)"
command -v jq >/dev/null 2>&1 || die "jq required"

if [[ -z "${REPO}" ]]; then
  REPO="$(gh repo view --json nameWithOwner -q .nameWithOwner 2>/dev/null || true)"
fi
[[ -n "${REPO}" ]] || die "could not detect repo; pass --repo owner/name"

has_runnable() {
  [[ -f "${OUT}/.zcode-build.json" ]] || return 1
  [[ -f "${OUT}/bin/code-server-oss" || -f "${OUT}/bin/code-server" || -f "${OUT}/server.sh" ]]
}

if has_runnable && [[ "${FORCE}" != "1" ]]; then
  log "Keeping existing runnable dist/server (use --force to re-download)"
  cat "${OUT}/.zcode-build.json" 2>/dev/null || true
  exit 0
fi

if [[ -z "${RUN_ID}" ]]; then
  log "Looking up latest successful CI run with artifact ${ARTIFACT_NAME} on ${REPO}"
  # Scan recent successful CI runs for a non-expired REH artifact (portable; no mapfile).
  CANDIDATE_FILE="${TMP:-/tmp}/zcode-reh-run-candidates.txt"
  # TMP not created yet — use a small temp under /tmp
  CANDIDATE_FILE="$(mktemp)"
  gh run list \
    --repo "${REPO}" \
    --workflow "${WORKFLOW}" \
    --status success \
    --limit 30 \
    --json databaseId,event,displayTitle,createdAt \
    --jq '.[] | "\(.databaseId)\t\(.event)\t\(.displayTitle)\t\(.createdAt)"' \
    >"${CANDIDATE_FILE}" 2>/dev/null || true

  if [[ ! -s "${CANDIDATE_FILE}" ]]; then
    rm -f "${CANDIDATE_FILE}"
    die "no successful ${WORKFLOW} runs found on ${REPO}. Trigger: Actions → CI → Run workflow → heavy_build=reh"
  fi

  while IFS= read -r row; do
    [[ -z "${row}" ]] && continue
    id="${row%%$'\t'*}"
    if gh api \
      -H "Accept: application/vnd.github+json" \
      "/repos/${REPO}/actions/runs/${id}/artifacts" \
      --jq ".artifacts[] | select(.name==\"${ARTIFACT_NAME}\" and .expired==false) | .name" \
      2>/dev/null | grep -qx "${ARTIFACT_NAME}"; then
      RUN_ID="${id}"
      log "Selected run ${RUN_ID}: ${row#*$'\t'}"
      break
    fi
  done <"${CANDIDATE_FILE}"
  rm -f "${CANDIDATE_FILE}"

  [[ -n "${RUN_ID}" ]] || die "no non-expired artifact named ${ARTIFACT_NAME} on recent successful runs. Run heavy_build=reh first."
fi

TMP="$(mktemp -d)"
trap 'rm -rf "${TMP}"' EXIT

log "Downloading artifact ${ARTIFACT_NAME} from run ${RUN_ID} → ${TMP}"
gh run download "${RUN_ID}" \
  --repo "${REPO}" \
  --name "${ARTIFACT_NAME}" \
  --dir "${TMP}"

# Normalize layout: artifact may unpack as:
#   TMP/<files>  or  TMP/zcode-reh-linux-x64/<files>  or  TMP/dist/server/<files>
SRC=""
for cand in \
  "${TMP}" \
  "${TMP}/${ARTIFACT_NAME}" \
  "${TMP}/dist/server" \
  "${TMP}/server"; do
  if [[ -f "${cand}/.zcode-build.json" ]] \
    || [[ -f "${cand}/bin/code-server-oss" ]] \
    || [[ -f "${cand}/bin/code-server" ]] \
    || [[ -f "${cand}/server.sh" ]] \
    || [[ -f "${cand}/package.json" && -d "${cand}/out" ]]; then
    SRC="${cand}"
    break
  fi
done

# Deep search one level if still unknown
if [[ -z "${SRC}" ]]; then
  while IFS= read -r -d '' d; do
    if [[ -f "${d}/.zcode-build.json" || -d "${d}/bin" || -d "${d}/out" ]]; then
      SRC="${d}"
      break
    fi
  done < <(find "${TMP}" -mindepth 1 -maxdepth 3 -type d -print0 2>/dev/null)
fi

[[ -n "${SRC}" ]] || die "could not locate REH package inside downloaded artifact (tree below):\n$(find "${TMP}" -maxdepth 3 | head -40)"

log "Staging from ${SRC} → ${OUT}"
rm -rf "${OUT}"
mkdir -p "${OUT}"
# Prefer rsync if available for clean copy; fall back to cp
if command -v rsync >/dev/null 2>&1; then
  rsync -a "${SRC}/" "${OUT}/"
else
  cp -R "${SRC}/." "${OUT}/"
fi

# Executables after zip/artifact download often lose +x
if [[ -d "${OUT}/bin" ]]; then
  chmod +x "${OUT}/bin/"* 2>/dev/null || true
  find "${OUT}/bin" -type f -exec chmod +x {} + 2>/dev/null || true
fi
[[ -f "${OUT}/node" ]] && chmod +x "${OUT}/node" || true
[[ -f "${OUT}/server.sh" ]] && chmod +x "${OUT}/server.sh" || true
[[ -f "${OUT}/bin/code-server-oss" ]] && chmod +x "${OUT}/bin/code-server-oss" || true
[[ -f "${OUT}/bin/code-server" ]] && chmod +x "${OUT}/bin/code-server" || true

# Ensure marker exists (CI upload should include it; synthesize stub if missing)
if [[ ! -f "${OUT}/.zcode-build.json" ]]; then
  warn "missing .zcode-build.json — writing fetch stub marker"
  cat > "${OUT}/.zcode-build.json" <<EOF
{
  "kind": "vscode-reh",
  "source": "github-actions-artifact",
  "artifact": "${ARTIFACT_NAME}",
  "runId": "${RUN_ID}",
  "repo": "${REPO}",
  "fetchedAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
EOF
else
  # Annotate fetch provenance without clobbering build fields
  if command -v jq >/dev/null 2>&1; then
    tmp_marker="${OUT}/.zcode-build.json.tmp"
    jq --arg src "github-actions-artifact" \
      --arg art "${ARTIFACT_NAME}" \
      --arg run "${RUN_ID}" \
      --arg repo "${REPO}" \
      --arg at "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
      '. + {source: $src, artifact: $art, runId: $run, repo: $repo, fetchedAt: $at}' \
      "${OUT}/.zcode-build.json" > "${tmp_marker}" \
      && mv "${tmp_marker}" "${OUT}/.zcode-build.json" \
      || true
  fi
fi

if ! has_runnable; then
  die "staged dist/server but no runnable binary (expected bin/code-server-oss). Contents:\n$(ls -la "${OUT}" | head -30)"
fi

log "REH ready at dist/server"
cat "${OUT}/.zcode-build.json"
log "Next: pnpm e2e:reh   # or ZCODE_E2E_REH_REQUIRED=1 pnpm e2e:reh"
log "Note: Linux REH binary will not run on macOS hosts — use CI vscode-reh-e2e or local darwin build."
