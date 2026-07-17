#!/usr/bin/env bash
# CI guard: production artifacts must not contain @vscode/test-web downloads.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FAIL=0

for path in dist apps/web/dist release; do
  target="${ROOT}/${path}"
  if [[ -d "${target}" ]]; then
    if find "${target}" -iname '*vscode-test-web*' 2>/dev/null | grep -q .; then
      echo "error: found .vscode-test-web artifacts under ${path}" >&2
      FAIL=1
    fi
  fi
done

if [[ ${FAIL} -ne 0 ]]; then
  exit 1
fi

echo "OK: no test-web release artifacts detected"
