#!/usr/bin/env bash
# H4 — build ZCode server image (optional multi-arch via buildx).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT}"

TAG="${ZCODE_DOCKER_TAG:-zcode:local}"
PLATFORMS=""
PUSH=0
LOAD=1
FILE="deploy/docker/Dockerfile.server"
CONTEXT="."
NO_CACHE=0

usage() {
  cat <<'EOF'
Usage: scripts/docker-build.sh [options]

  --tag <name>              Image tag (default: zcode:local or ZCODE_DOCKER_TAG)
  --platforms <list>        Comma-separated platforms for buildx
                            e.g. linux/amd64 or linux/amd64,linux/arm64
  --push                    Push multi-arch manifest (implies --platforms, no --load)
  --no-load                 Do not docker load (useful with --push only)
  --no-cache                Pass --no-cache to build
  -h, --help

Examples:
  # Host architecture (docker build)
  bash scripts/docker-build.sh

  # Multi-arch (requires docker buildx; typically --push to a registry)
  bash scripts/docker-build.sh --platforms linux/amd64,linux/arm64 --push --tag ghcr.io/spinupdev/zcode:dev

  # Single foreign arch with load (qemu/binfmt required)
  bash scripts/docker-build.sh --platforms linux/amd64 --tag zcode:amd64
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --tag) TAG="$2"; shift 2 ;;
    --platforms) PLATFORMS="$2"; shift 2 ;;
    --push) PUSH=1; LOAD=0; shift ;;
    --no-load) LOAD=0; shift ;;
    --no-cache) NO_CACHE=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "unknown arg: $1" >&2; usage; exit 2 ;;
  esac
done

log() { printf '==> %s\n' "$*"; }
die() { echo "error: $*" >&2; exit 1; }

need_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "missing required command: $1"
}

need_cmd docker

extra=()
if [[ "${NO_CACHE}" == "1" ]]; then
  extra+=(--no-cache)
fi

if [[ -z "${PLATFORMS}" ]]; then
  log "docker build (host platform) → ${TAG}"
  docker build "${extra[@]}" -f "${FILE}" -t "${TAG}" "${CONTEXT}"
  log "OK ${TAG}"
  docker image inspect "${TAG}" --format 'id={{.Id}} size={{.Size}} arch={{.Architecture}} os={{.Os}}'
  exit 0
fi

need_cmd docker
if ! docker buildx version >/dev/null 2>&1; then
  die "docker buildx required for --platforms"
fi

# Ensure a builder that can multi-arch
BUILDER="${ZCODE_BUILDX_BUILDER:-zcode-multi}"
if ! docker buildx inspect "${BUILDER}" >/dev/null 2>&1; then
  log "creating buildx builder ${BUILDER}"
  docker buildx create --name "${BUILDER}" --driver docker-container --use
else
  docker buildx use "${BUILDER}"
fi
docker buildx inspect --bootstrap >/dev/null

args=(buildx build -f "${FILE}" -t "${TAG}" --platform "${PLATFORMS}" "${extra[@]}")
if [[ "${PUSH}" == "1" ]]; then
  args+=(--push)
  log "buildx multi-arch push platforms=${PLATFORMS} tag=${TAG}"
elif [[ "${LOAD}" == "1" ]]; then
  # --load only supports a single platform
  if [[ "${PLATFORMS}" == *","* ]]; then
    die "docker buildx --load supports one platform; use a single platform or --push"
  fi
  args+=(--load)
  log "buildx load platform=${PLATFORMS} tag=${TAG}"
else
  log "buildx build (no load/push) platforms=${PLATFORMS} tag=${TAG}"
fi

docker "${args[@]}" "${CONTEXT}"
log "OK ${TAG} platforms=${PLATFORMS}"
