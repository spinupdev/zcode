# Resume prompt — ZCode (paste into a new agent session)

Self-contained handoff. **Do not ask the user what to do** — execute **PLAN.md §5** in order and ship commits.

---

You are continuing work on **ZCode** at the monorepo root.

| Field | Value |
| --- | --- |
| **Product / CLI** | **ZCode** / `zcode` — **not** [coder/code-server](https://github.com/coder/code-server) |
| **Canonical GitHub** | https://github.com/spinupdev/zcode (`origin` = `git@github.com:spinupdev/zcode.git`) |
| **Local path** | may still be `…/code-server` on disk — product is ZCode |
| **Branch** | `main` (keep in sync with `origin/main`) |
| **VS Code pin** | `1.129.0` → SHA `125df467…` ([docs/vscode-pin.md](./docs/vscode-pin.md)) |
| **Snapshot HEAD** | check `git log -1` (handoff written near `13cfd0a` + later) |

## Read first (required)

1. **[`PLAN.md`](./PLAN.md)** — architecture, work tracker, **§5 queue**, §7 invariants, §10 changelog  
2. **[`AGENTS.md`](./AGENTS.md)** — short bootstrap  
3. Recent commits on `main` for context  
4. Only if needed: [`docs/design-dual-mode-vscode-ide.md`](./docs/design-dual-mode-vscode-ide.md)

## Product facts (do not regress)

- **Primary IDE: `/`** (VS Code Web workbench). **Not** `/ide/` (legacy routes removed).  
- **Debug SPA: `/debug/`** — git dogfood only; **off in production** (`NODE_ENV=production`). Enable with `NODE_ENV=development` and/or `--spa-debug` / `ZCODE_SPA_DEBUG`.  
- Dual mode = workbench `remoteAuthority` / EH / providers — **not** a custom BackendFacade.  
- Browser git: isomorphic-git + same-origin stateless **`/git-proxy`**; durable FS = **OPFS (ZenFS) primary**, IndexedDB **`zcode-fs-v1`** fallback ([docs/b2b-opfs-zenfs.md](./docs/b2b-opfs-zenfs.md)).  
- No secrets in URLs (HttpOnly cookies only for REH). Prefer extensions over VS Code core patches.  
- Live browser host (H3): Cloudflare Pages + Worker; deploy via `pnpm deploy:cloudflare` / `scripts/deploy-cloudflare.sh`.  
  - Pages file size limit **25 MiB** → CDN uses **dogfood** `vscode-web@1.91` unless a Pages-safe tree is provided (`ZCODE_CF_VSCODE_WEB_DIR`). Owned esbuild bundles can exceed limit.

## Already done (do **not** re-do)

Trackers in PLAN.md are authoritative. Summary of major packages **done**:

| Area | IDs | Notes |
| --- | --- | --- |
| Foundation | F1–F6 | Repo is **spinupdev/zcode** |
| Browser | B1–B8b | OPFS B2b; SCM; **Open Repository** in-IDE clone (`zcode.git.openRepository` + `remoteHub` alias); Zeish favicon |
| Remote | R1–R6 | REH artifact, cookie→token proxy, STRICT e2e, PTY `printf zcode_echo_ok` + `ZCODE_E2E_REH_PTY_REQUIRED=1` |
| Workbench | M0a–M3, M1–M2 | Owned web path local; dual-mode; CSP/diagnostics; Playwright |
| Hosting | H1–H4 | CF Worker + live Pages; Docker non-root multi-arch |
| URL layout | — | Product at `/`; SPA at `/debug/`; no `/ide` |

Useful recent themes on `main` (not exhaustive):

- `feat(git): open any HTTPS repo in-IDE with Zeish branding`  
- CF Pages/Worker live deploy + dark theme / splash / production IDE load fixes  
- `feat(web): serve product IDE at / and debug SPA at /debug/`  
- H3 dry-run + H4 Docker harden  
- R6 STRICT PTY polish  
- B2b ZenFS OPFS; `pnpm fetch:reh`; F6 remote rename  

Local artifacts often present (never commit binaries):

- `dist/vscode-web/.zcode-vscode-web.json` → `"source":"owned"` (local)  
- `dist/server/.zcode-build.json` → darwin REH when built on this host  

## Your mission — execute without asking

Work through **PLAN.md §5 in order**. Do not pause for product decisions. If blocked by environment (disk, CF auth, missing REH binary), document the exact blocker in PLAN.md, implement everything that can still ship (scripts, tests, docs, CI), mark the tracker accurately, and continue.

### P0 — next packages (from PLAN §5)

1. **CI: enable `ZCODE_E2E_REH_PTY_REQUIRED=1`** on the heavy REH e2e job (`workflow_dispatch` / `heavy_build=reh-and-e2e`) once Linux REH + remote shell is stable.  
   - Soft local: `pnpm e2e:reh`  
   - STRICT: `ZCODE_E2E_REH_STRICT=1 pnpm e2e:reh`  
   - PTY hard-fail: `ZCODE_E2E_REH_PTY_REQUIRED=1`  
   - Docs: [docs/r6-terminal-e2e.md](./docs/r6-terminal-e2e.md), [docs/reh-cookie-proxy.md](./docs/reh-cookie-proxy.md)  
   - Fetch Linux artifact: `pnpm fetch:reh` (needs `gh` + prior CI REH build)

2. **Optional custom domain** on Cloudflare Pages + Worker routes (live `*.pages.dev` already up).  
   - [docs/hosting-production.md](./docs/hosting-production.md), [deploy/cloudflare/README.md](./deploy/cloudflare/README.md)  
   - `pnpm hosting:dry-run` · `pnpm deploy:cloudflare`  
   - Domain attaches to **Pages**, not the Worker alone (see recent deploy docs commits).

3. **Optional: SPA git-worker dual-open OPFS coordinator**  
   - Today: clone in MemoryFs worker → import into main-thread OPFS/IDB.  
   - Design target: single FS coordinator / no dual open on same OPFS path ([docs/b2b-opfs-zenfs.md](./docs/b2b-opfs-zenfs.md)).  
   - Do **not** expand the debug SPA as the product IDE.

4. **H5 observability** (metrics / structured logs) when ops needs it — design first if scope unclear.

### P1 / post-MVP (only if P0 clear)

- **P0 ADR** browser↔remote workspace sync (gates upgrade)  
- **P1** browser→remote upgrade  
- **P2** session API + OIDC  
- **P3** microVM orchestrator  

## Quick start

```bash
pnpm install && pnpm build
./scripts/fetch-vscode-web.sh
pnpm --filter @zcode/workbench build
pnpm --filter zcode-browser-fs build
pnpm --filter zcode-git build

# DEV: product IDE + /git-proxy + /debug SPA
NODE_ENV=development node apps/cli/dist/cli.js web --dir apps/web/dist --port 5000 --spa-debug
# or: pnpm dev:ide
```

| URL | Expect |
| --- | --- |
| http://127.0.0.1:5000/ | **VS Code Web** (product IDE) + `zcode-opfs` |
| http://127.0.0.1:5000/debug/ | Debug SPA (DEV only) |
| http://127.0.0.1:5000/git-proxy/healthz | `{"ok":true,...}` |

```bash
pnpm test
pnpm e2e:browser
pnpm e2e:playwright
pnpm e2e:reh
ZCODE_E2E_REH_STRICT=1 pnpm e2e:reh

# Ops
pnpm hosting:dry-run
pnpm deploy:cloudflare    # needs wrangler login
pnpm docker:build
pnpm fetch:reh            # Linux REH from Actions → dist/server
```

Owned rebuilds (long; Node **24**; `GITHUB_TOKEN` helps ripgrep):

```bash
./scripts/build-web.sh --check   # then --package if disk allows
./scripts/build-server.sh --check
```

## Working rules

- Update **PLAN.md** tracker (Status + Last note) and **§10 changelog** when starting/finishing packages.  
- Atomic commits with complete sentences; **no secrets** in URLs/logs.  
- Prefer extensions/wrappers over VS Code core patches.  
- Run tests for packages you touch; Playwright when web surfaces change.  
- If OOM on `pnpm install`, install by filter.  
- Full REH/web gulp builds are long — ship partial progress and move on.  
- **Never commit** `dist/server` binaries or fat vscode trees.  
- Push to **`origin` = spinupdev/zcode** when the user wants remote updated (confirm only for force-push / destructive shared ops).

## Autonomy

Do **not** ask which task to pick, for credentials already documented, or for confirmation on local reversible work (edits, tests, commits). Only stop if you need a secret the repo does not provide, or an irreversible shared action (force-push, production domain DNS you cannot verify) — then state what finished and what is blocked.

**Start now with PLAN.md §5 item 1** (CI PTY hard-fail on heavy REH e2e), then custom domain / OPFS coordinator / H5 as capacity allows.

---

## Invariants (copy of PLAN §7)

1. No connection secrets in URLs (`tkn`, `cc`, `connectionToken` query).  
2. Git proxy is stateless — no repo storage on server for browser mode.  
3. `@vscode/test-web` is never a production asset.  
4. Dual-mode is workbench config, not a custom file/terminal RPC bus.  
5. MVP multi-tenant untrusted Docker is forbidden — microVM first.  
6. Product name is ZCode.  
7. Prefer extensions + wrappers over deep VS Code patches.

---

*This file is a session bootstrap. Canonical status lives in PLAN.md — update PLAN when work lands, and refresh the Snapshot HEAD line above if you rewrite this handoff.*
