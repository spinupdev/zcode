# REH cookie-auth attach (R3b)

## Problem

VS Code REH expects a **connection token**. Putting it in the browser URL (`?tkn=`) violates KD12. ZCode maps:

```text
password login → HttpOnly zcode_sess cookie → internal connectionToken → REH
```

The workbench never receives the token string.

## Flow

```text
Browser                         ZCode serve                    REH (127.0.0.1:port+1)
   |  POST /login                  |                              |
   |------------------------------>| createSession(token)         |
   |  Set-Cookie: zcode_sess=…     |                              |
   |  GET /?mode=remote&ready=1    |                              |
   |  WS upgrade / …               |                              |
   |------------------------------>| resolve cookie → token       |
   |                               | proxy WS/HTTP + inject       |
   |                               | connectionToken on upstream  |
   |                               |----------------------------->|
```

## Implementation

| Piece | Location |
| --- | --- |
| Session ↔ token | `packages/server/src/auth/cookie-bridge.ts` |
| HTTP reverse proxy | `packages/server/src/reh/proxy.ts` `tryProxyHttp` |
| WebSocket upgrade | `handleRehUpgrade` + `start.ts` `server.on('upgrade')` |
| Spawn with token | `packages/server/src/reh/spawn.ts` `--connection-token` |
| Session API | `GET /v1/session` → `{ authenticated, ready, authority, rehProxy }` |

Reserved shell paths (`/login`, `/`, `/debug`, `/git-proxy`, `/vscode`, …) are **not** proxied.

## Run

```bash
# After REH artifact exists (R2c):
./scripts/build-server.sh          # → dist/server + .zcode-build.json

# Or force spawn when artifact present:
ZCODE_SPAWN_REH=1 node apps/cli/dist/cli.js serve --password secret --port 8080

# Login in browser, then:
# /login → /?mode=remote&authority=127.0.0.1:8080&ready=1
```

Without `dist/server` artifact, REH mode is `none` and proxy is idle (browser mode still works).

## REH token model

VS Code’s WebSocket handshake requires the **browser client** to send
`msg1.auth === connectionToken`. Putting that token in the workbench risks
leaks (URL/query). ZCode’s default:

| Layer | Behavior |
| --- | --- |
| REH process | `--without-connection-token` (loopback only) |
| Shell proxy | Requires HttpOnly `zcode_sess` for REH paths |
| Browser | Never receives a REH connection token |

Optional: `ZCODE_REH_REQUIRE_TOKEN=1` forces `--connection-token` and proxy
injection of `tkn=` (then the workbench must also obtain the token via an
authenticated channel — not the default path).

## R2c — REH artifact

```bash
export GITHUB_TOKEN="$(gh auth token)"  # avoids @vscode/ripgrep 403
./scripts/build-server.sh --check
./scripts/build-server.sh          # multi-hour; 40GB+ disk; Node 24
# CI: Actions → CI → Run workflow → heavy_build=reh
# Artifact: zcode-reh-linux-x64 → extract to dist/server/
# Or: pnpm fetch:reh   # scripts/fetch-reh-artifact.sh via gh
```

Marker: `dist/server/.zcode-build.json`. Binaries are **not** committed.

## R6 — Terminal e2e

See [r6-terminal-e2e.md](./r6-terminal-e2e.md).

```bash
pnpm e2e:reh                         # skips if no artifact
ZCODE_E2E_REH_REQUIRED=1 pnpm e2e:reh
# CI: heavy_build=reh-and-e2e
```

## Security notes

- Cookie: `HttpOnly; SameSite=Lax; Path=/` (+ `Secure` when `ZCODE_SECURE_COOKIES=1`)
- Token only on **loopback REH hop**, never in JSON login responses  
- Login rate-limited (`LoginRateLimiter`)

## Tests

```bash
pnpm --filter @zcode/server test
# proxy.test.ts: reserved paths, HTTP inject token, 401 without cookie
# terminal-flow.test.ts: login → mock REH /version (R6 contract without binary)
# artifact.test.ts: dist/server marker/binary detection
```
