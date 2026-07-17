#!/usr/bin/env bash
# End-to-end: same-origin /git-proxy + shallow clone via browser-agent (Node harness).
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT}"
export PATH="/opt/homebrew/bin:${PATH}"

PORT="${ZCODE_E2E_PORT:-15001}"
log() { printf '==> %s\n' "$*"; }

log "build packages"
pnpm --filter @zcode/git-proxy build
pnpm --filter @zcode/browser-agent build
pnpm --filter @zcode/cli build
pnpm --filter @zcode/web build

log "start zcode web on :${PORT}"
node apps/cli/dist/cli.js web --dir apps/web/dist --port "${PORT}" &
PID=$!
cleanup() { kill "${PID}" 2>/dev/null || true; }
trap cleanup EXIT

for i in $(seq 1 30); do
  if curl -sf "http://127.0.0.1:${PORT}/git-proxy/healthz" >/dev/null; then
    break
  fi
  sleep 0.2
done

curl -sf "http://127.0.0.1:${PORT}/git-proxy/healthz" | tee /tmp/zcode-e2e-health.json
echo
curl -sf -o /dev/null -w "spa %{http_code}\n" "http://127.0.0.1:${PORT}/"
test -f apps/web/dist/git-worker.js

log "clone via agent + same-origin proxy"
node --input-type=module <<JS
import { createBrowserAgent, MemoryFs } from './packages/browser-agent/dist/index.js';
const agent = createBrowserAgent({ fs: new MemoryFs(), hydrateFromFs: false });
const id = crypto.randomUUID();
const ws = await agent.clone({
  workspaceId: id,
  url: 'https://github.com/isomorphic-git/isomorphic-git',
  corsProxyUrl: 'http://127.0.0.1:${PORT}/git-proxy',
  depth: 1,
  onProgress: (p) => {
    if (p.phase === 'done' || (p.receivedObjects && p.receivedObjects % 50 === 0)) {
      console.log('progress', p.phase, p.receivedObjects ?? '', p.totalObjects ?? '');
    }
  },
});
const files = await agent.listFiles(id);
const hits = await agent.search({ workspaceId: id, query: 'isomorphic', maxHits: 5 });
console.log('CLONE_OK', ws.name, 'files', files.length, 'searchHits', hits.length);
if (files.length < 10) process.exit(2);
if (hits.length < 1) process.exit(3);
JS

log "e2e-browser OK"
