# R6 — Terminal e2e against REH (cookie proxy)

## Goal

Prove remote mode works end-to-end:

1. Password login → HttpOnly `zcode_sess` (no token in URL)
2. REH spawned from **owned** `dist/server` (R2c)
3. Cookie-authorized HTTP/WS reverse proxy injects `connectionToken` only on the loopback hop
4. Workbench remote mode + integrated terminal runs `echo ok`

## Prerequisites

| Item | Source |
| --- | --- |
| REH artifact | `./scripts/build-server.sh` → `dist/server/` + `.zcode-build.json` |
| Or CI download | `./scripts/fetch-reh-artifact.sh` / `pnpm fetch:reh` (Linux artifact from Actions) |
| Or CI job | `workflow_dispatch` **heavy_build=reh-and-e2e** downloads artifact → normalize → e2e |
| Staged web | dogfood or owned `dist/vscode-web` |
| Node | monorepo Node 20+ for ZCode; REH build used Node 24 |

## Commands

```bash
# Soft: exits 0 if no REH artifact (default local / PR-safe)
pnpm e2e:reh
# same:
bash scripts/e2e-reh-terminal.sh

# Hard fail without artifact (CI after REH job):
ZCODE_E2E_REH_REQUIRED=1 pnpm e2e:reh

# STRICT: remote workbench + product contract; PTY best-effort (annotates if missing)
# Needs: dist/server REH, owned or dogfood vscode-web, Chromium
ZCODE_E2E_REH_STRICT=1 ZCODE_E2E_REH_REQUIRED=1 pnpm e2e:reh

# STRICT + hard-fail when integrated terminal does not print zcode_echo_ok
ZCODE_E2E_REH_STRICT=1 ZCODE_E2E_REH_PTY_REQUIRED=1 ZCODE_E2E_REH_REQUIRED=1 pnpm e2e:reh

# Optional: longer REH boot wait (default 45–60s)
ZCODE_REH_READY_MS=90000 ZCODE_E2E_REH_STRICT=1 pnpm e2e:reh
```

Manual dogfood:

```bash
./scripts/build-server.sh   # multi-hour; 40GB+ disk
pnpm --filter @zcode/workbench build
./scripts/fetch-vscode-web.sh
node apps/cli/dist/cli.js serve ./workspace --port 8080 --password secret
# browser: login → /ide/?mode=remote&authority=127.0.0.1:8080&ready=1
# Terminal: echo ok
```

## Always-on coverage (no REH binary)

`pnpm --filter @zcode/server test` includes:

| Test | What it proves |
| --- | --- |
| `reh/proxy.test.ts` | Cookie → token inject; 401 without session |
| `reh/terminal-flow.test.ts` | Login → mock REH `/version` via proxy |
| `reh/artifact.test.ts` | Marker/binary detection helpers |
| `reh/wait.test.ts` | Readiness poll for boot races |

## Playwright layout

| Config | Suite | Server |
| --- | --- | --- |
| `e2e/playwright.config.ts` | M3 routes / SPA / IDE | `zcode web` |
| `e2e/playwright.reh.config.ts` | R6 terminal | `zcode serve` + REH |

## CI policy

- **Default PR**: M3 Playwright only (no multi-hour REH).
- **workflow_dispatch** `heavy_build=reh`: package REH → artifact `zcode-reh-linux-x64`.
- **workflow_dispatch** `heavy_build=reh-and-e2e`: package + download into `dist/server` + normalize (+x) + `ZCODE_E2E_REH_REQUIRED=1 pnpm e2e:reh`.
- **Local Linux agents**: `pnpm fetch:reh` then `ZCODE_E2E_REH_REQUIRED=1 pnpm e2e:reh`.

## Blockers (agent host notes)

Full R6 UI pass needs a successful **R2c** package. When `dist/server` is absent, R6 scripts **skip** and unit tests still guard the cookie proxy contract.

## Related

- [reh-cookie-proxy.md](./reh-cookie-proxy.md) — R3b design  
- [building-vscode.md](./building-vscode.md) — REH compile resources  
