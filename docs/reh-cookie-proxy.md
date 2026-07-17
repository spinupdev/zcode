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
   |  GET /ide/?mode=remote&ready=1|                              |
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

Reserved shell paths (`/login`, `/ide`, `/git-proxy`, `/vscode`, …) are **not** proxied.

## Run

```bash
# After REH artifact exists (R2c):
./scripts/build-server.sh          # → dist/server + .zcode-build.json

# Or force spawn when artifact present:
ZCODE_SPAWN_REH=1 node apps/cli/dist/cli.js serve --password secret --port 8080

# Login in browser, then:
# /ide/?mode=remote&authority=127.0.0.1:8080&ready=1
```

Without `dist/server` artifact, REH mode is `none` and proxy is idle (browser mode still works).

## R2c — REH artifact

```bash
./scripts/build-server.sh --check
./scripts/build-server.sh          # multi-hour; 40GB+ disk
# CI: workflow_dispatch job vscode-reh-build
```

Marker: `dist/server/.zcode-build.json`. Binaries are **not** committed.

## Security notes

- Cookie: `HttpOnly; SameSite=Lax; Path=/` (+ `Secure` when `ZCODE_SECURE_COOKIES=1`)
- Token only on **loopback REH hop**, never in JSON login responses  
- Login rate-limited (`LoginRateLimiter`)

## Tests

```bash
pnpm --filter @zcode/server test
# proxy.test.ts: reserved paths, HTTP inject token, 401 without cookie
```
