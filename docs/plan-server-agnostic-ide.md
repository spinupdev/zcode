# Plan: Server-agnostic IDE (same-origin, live attach, browser WASM runtimes)

| Field | Value |
| --- | --- |
| **Status** | Active (core attach + WASM + sync shipped) |
| **Last updated** | 2026-07-18 (WS3 + RA0 concluded) |
| **ADRs** | [0001](./adr/0001-server-agnostic-ide.md) · [0002](./adr/0002-browser-remote-workspace-sync.md) |
| **Tracker** | [PLAN.md](../PLAN.md) §4.6 |

## Product north star

**ZCode is an IDE that does not depend on a server.**

| Always true | Optional |
| --- | --- |
| VS Code Web UI in the browser | REH / remote PTY / native LSPs |
| Workspace + edit on client FS (OPFS / IDB) | Full remote filesystem / remote EH |
| Run / debug **in browser via WASM** (Node, Python) | Run on remote machine |
| Git via isomorphic-git + `/git-proxy` | System `git` on server |

**Topology:** **same-origin / same-site only** (user confirmed). No CDN shell ↔ separate runtime cookie work in this plan. Co-serve or same-site gateway is enough; reuse today’s cookie + REH proxy (R3b).

**Cross-origin Topology B / OQ10:** deferred indefinitely for this track.

---

## Goals (this plan)

1. **Same-site remote attach** — browser workbench can connect to a co-served (or same-site) REH.
2. **Attach without losing the editor** — user does not “start over”; ideally **no full workbench reload**; if upstream forces a reload, **seamless state restore** (tabs, layout, dirty buffers).
3. **Extensions own mode / runtime switching** — prefer `zcode-*` web extensions over core patches.
4. **Browser execution without remote** — WASM (or equivalent) runtimes for **Python** and **Node-compatible JS**, with terminal/tasks integrated in the editor.
5. **IDE agnostic of server** — capabilities and “execution backend” are pluggable; absence of REH is a normal, polished mode.

---

## What already exists

| Capability | Status |
| --- | --- |
| Browser IDE at `/` + OPFS FS + git | **Done** (B*, M0*) |
| Same-origin remote (`zcode serve` + cookie → REH) | **Done** (R3b, M1, R6) |
| Dual-mode at **bootstrap** (`?mode=remote`) | **Done** — mode chosen **before** `create()` |
| Live attach / mode switch mid-session | **In progress** — RA1/RA2 |
| `zcode-remote` | **Building** (was upgrade stub) |
| Browser WASM Node / Python runtimes | **Building** (WB0–WB2) |
| Workspace browser↔remote sync ADR | **Done** — ADR 0002 (SA1) |
| Server-agnostic product ADR | **Done** — ADR 0001 (SA0) |
| Protocol execution backends | **Done** — SA2 |

---

## Architecture: pluggable backends (not “two products”)

```text
┌─────────────────────────────────────────────────────────────┐
│  VS Code Web workbench (always browser UI)                  │
│  Workspace FS: zcode-opfs (primary)  ±  remote FS when attached │
└───────────────┬─────────────────────────────┬───────────────┘
                │                             │
     ┌──────────▼──────────┐       ┌──────────▼──────────┐
     │ Execution backends  │       │ Connection backends │
     │ (extensions)        │       │ (extensions)        │
     │  · browser-wasm     │       │  · none (default)   │
     │    - python (Pyodide)│       │  · same-origin REH  │
     │    - node (WASM/WC) │       │    attach / detach  │
     │  · remote (REH PTY) │       │                     │
     └─────────────────────┘       └─────────────────────┘
```

**Normative rules:**

1. **Default boot = browser mode** — no `remoteAuthority` required. Editor always loads.
2. **Server is a capability**, discovered via same-origin `/v1/session` (already exists). If REH offline → browser + WASM still full product.
3. **Do not invent a BackendFacade for editor IPC** (KD2). Remote file/terminal/EH still use upstream VS Code remote protocol when fully attached.
4. **Day-to-day “run code”** should go through an **execution backend API** (extension), so WASM vs remote is a setting/command — not a product reinstall.

---

## Hard problem: attach without reload

Upstream VS Code typically bakes `remoteAuthority` into workbench **create()** and treats authority changes as **window reload**. We plan in two quality tiers so we ship value early.

### Tier 1 — Seamless attach (ship first): state-preserving reload

User clicks **Connect to Remote** → login/cookie if needed → export/sync workspace (per ADR) → **controlled reload** to `mode=remote` with:

- Restore open editors, view state, layout (VS Code storage + our workspace id)
- Dirty buffer policy: flush to OPFS **before** reload; reopen from remote or rehydrate
- No secret query params; cookie already set (same-origin)

**Feels** continuous; technically one reload.

### Tier 2 — True mid-session attach (stretch / research-gated)

Stay on the same workbench instance:

| Approach | Pros | Cons |
| --- | --- | --- |
| **A. Remote as execution-only** (extension PTY/tasks/LSP proxy to REH; workspace stays OPFS) | No reload; matches “agnostic IDE”; simpler | Not full remote FS/EH; partial remote |
| **B. Dynamic `RemoteAuthorityResolver` + open remote folder** | Closer to real VS Code remote | Web support may force reload; may need quilt |
| **C. Multi-root: keep OPFS root + add `vscode-remote://` folder** | Hybrid | Often reloads; dual FS complexity |

**Decision for this plan:**

- **Product default for “Run”:** Tier-2 style **A** — execution backends switch **without reload**.
- **Product “Open full remote workspace”:** Tier 1 seamless reload first; pursue B/C only if spike proves no-reload on pin 1.129 web.

Spike (small, time-boxed) before large Tier 2 investment:

```text
Spike S1: Can web workbench mid-session set remoteAuthority / open vscode-remote folder
          without full reload on pin 1.129?
  → document outcome → choose B/C or stick to Tier1 + execution-only remote
```

---

## Work streams (prioritized)

### P0 — Product model + ADR (docs, 1–2 days)

| ID | Package | Deliverable |
| --- | --- | --- |
| **SA0** | ADR: server-agnostic IDE | Locks same-origin, execution backends, attach tiers, no cross-origin |
| **SA1** | ADR: browser↔remote workspace sync | Format (git bundle vs tar), when sync runs, conflict policy — gates full remote open |
| **SA2** | Protocol: `ExecutionBackend` + `ConnectionState` | Types in `@zcode/protocol` (mode becomes capability matrix, not only `browser\|remote`) |

**Capabilities sketch (extend, don’t break):**

```ts
// conceptual — refine in SA2
type ExecutionBackendId = 'browser-python' | 'browser-node' | 'remote-reh' | 'none';

interface ConnectionState {
  remote: 'disconnected' | 'connecting' | 'attached' | 'error';
  authority?: string; // host:port same-origin
  /** full remote workspace vs execution-only */
  scope: 'none' | 'execution' | 'workspace';
}

interface ProductCapabilities {
  // existing fields…
  executionBackends: ExecutionBackendId[];
  defaultExecutionBackend: ExecutionBackendId;
}
```

Update **PLAN.md** tracker: supersede cross-origin XO* queue with SA* / WB* / RT* IDs below.

---

### P1 — Live remote attach (same-origin, extension-first)

| ID | Package | Deliverable |
| --- | --- | --- |
| **RA0** | Spike S1 (no-reload feasibility) | Written result in `docs/spikes/remote-attach-no-reload.md` |
| **RA1** | `zcode-remote` extension (new or expand upgrade stub) | Commands: Connect / Disconnect / Status; uses `/v1/session` + `/login` same-origin |
| **RA2** | Tier 1 seamless attach | Cookie ready → sync (if SA1) → reload with state restore → remote workbench |
| **RA3** | Execution-only remote (no reload) | When REH available: terminal/tasks target remote PTY **without** flipping whole workspace to remoteAuthority (if API allows; else soft-link to WASM until full attach) |
| **RA4** | Status bar / diagnostics | Show `Browser · WASM` vs `Remote · host` · copy-safe report (extend `zcode-diagnostics`) |
| **RA5** | E2E | Playwright: browser boot → connect remote (Tier 1) → terminal echo; no secrets in URL |

**Reuse:**

- `CookieTokenBridge`, REH proxy, `/v1/session` — no new auth model  
- `extensions/zcode-remote` — Connect / Disconnect REH (upgrade command is an alias of Connect)
- Same-origin only: `authority = location.host` when co-served  

**Out of scope for P1:** cross-origin cookies, OIDC, multi-tenant session API.

---

### P2 — Browser WASM runtimes (no server)

Ship editor-integrated **Run** without REH.

| ID | Package | Deliverable |
| --- | --- | --- |
| **WB0** | Runtime provider interface | Shared extension API: `startSession`, `runFile`, `runSelection`, `createTerminal`, `dispose` |
| **WB1** | **Python** backend (Pyodide) | `zcode-runtime-python` web extension; Run File / REPL terminal; packages via Pyodide micropip (document limits) |
| **WB2** | **Node / JS** backend | `zcode-runtime-node` — choose after spike (see below) |
| **WB3** | Tasks + CodeLens / Run button | Wire to active backend; honor `zcode.execution.backend` setting |
| **WB4** | FS bridge | Runtimes read/write **workspace via `zcode-opfs` / vscode.workspace.fs** (not a second private FS) |
| **WB5** | CSP / asset hosting | Serve `.wasm` + CDN or same-origin wasm assets; extend `buildContentSecurityPolicy` as needed |
| **WB6** | E2E / unit | Python `print("ok")`; Node `console.log("ok")` in headless where feasible |

#### Node-in-browser technology choice (spike WB2a)

| Option | Fit | Notes |
| --- | --- | --- |
| **WebContainers** (`@webcontainer/api`) | Strong Node compat | Licensing/CDN; commercial terms — verify for ZCode |
| **Node WASI / wasm node builds** | Lighter | Weaker npm compatibility |
| **wasmer / wasi-sdk custom** | Flexible | Higher eng cost |
| **QuickJS / esm.sh worker** | Fast path for pure JS | Not real Node |

**Spike output:** pick one primary Node backend + fallback (e.g. worker eval for simple JS). Prefer **no core VS Code patch**.

#### Python

- **Pyodide** is the default recommendation (mature, in-browser CPython).  
- Terminal UX: xterm via VS Code terminal API if possible, else webview panel v1.  
- Document: no arbitrary native wheels; scientific stack partial.

---

### P3 — Workspace continuity (when full remote open)

| ID | Package | Deliverable |
| --- | --- | --- |
| **WS1** | Implement SA1 ADR | Export OPFS → git bundle or tar; import on remote session |
| **WS2** | Pre-attach flush | Dirty editors save to OPFS; progress UI |
| **WS3** | Optional detach | Remote → browser: pull changed files back (policy from ADR) |

Depends on RA2 for full remote workspace attach.

---

### P4 — Polish (after P1–P2)

| ID | Item |
| --- | --- |
| **PL1** | Default backend: auto (`remote-reh` if attached else `browser-*` by language) |
| **PL2** | Welcome / walkthrough: “Run in browser” vs “Connect remote” |
| **PL3** | PLAN.md / RESUME.md queue rewrite; retire cross-origin XO priorities |
| **PL4** | CI: WASM runtime smoke + existing `e2e:reh` |

---

## Priority order (what we do first)

```text
1. SA0 + SA1 + SA2     Product/ADR + protocol types
2. RA0                 No-reload spike (1–2 days, gates Tier 2 ambition)
3. WB0 + WB1           Runtime interface + Python (high user value, no REH)
4. RA1 + RA2 + RA4     Extension connect + Tier 1 seamless attach + status
5. WB2 + WB3 + WB4     Node WASM + Run UX + FS bridge
6. RA3 / RA5           Execution-only remote if spike allows; e2e
7. WS1–WS3             Full workspace sync for remote open
8. PL*                 Polish + CI
```

**Why this order:**

- Same-origin remote **already works** at cold boot — biggest gap is **live attach UX** and **serverless run**.  
- **Python WASM** delivers “IDE without server” immediately and does not block on REH.  
- **Tier 1 attach** unblocks “connect remote” without betting the roadmap on a hard upstream spike.  
- Workspace sync only matters for **full remote workspace**, not for WASM run.

---

## Extension map

| Extension | Role | Priority |
| --- | --- | --- |
| `zcode-browser-fs` | OPFS provider (exists) | maintain |
| `zcode-git` | Browser SCM (exists) | maintain |
| `zcode-diagnostics` | Mode/backend report (extend) | P1 |
| **`zcode-remote`** (from upgrade stub) | Connect / disconnect / seamless attach | P1 |
| **`zcode-runtime-python`** | Pyodide backend | P2 |
| **`zcode-runtime-node`** | Node/JS WASM backend | P2 |
| **`zcode-runtime-core`** (optional package) | Shared provider registry, settings, Run commands | P2 |

Prefer **extensions + thin shell** over quilt patches. Quilt only if spike RA0 proves a one-line web remote attach hook is required.

---

## Same-origin topology (normative)

```text
Browser
  └─ https://host/          workbench (always)
  └─ https://host/vscode    static assets
  └─ https://host/v1/session
  └─ https://host/login     cookie zcode_sess
  └─ https://host/*         REH reverse proxy (when REH up)
         └─ loopback REH
```

- Attach authority: **`location.host`** (co-serve).  
- Cookie: existing `HttpOnly; SameSite=Lax`.  
- No cross-site `SameSite=None` work in this plan.

Optional later: same-site gateway (`ide.` + `reh.` under one registrable domain) — treat as ops, not a new product mode.

---

## Explicit non-goals (this plan)

| Out | Why |
| --- | --- |
| Cross-origin CDN shell + separate REH cookies | User chose same-origin; OQ10 deferred |
| Full SaaS OIDC / multi-tenant session API | Not required for self-host attach |
| microVM | Unrelated |
| Replacing VS Code remote protocol with custom RPC | KD2 |
| Perfect native npm/pip in browser | Document WASM limits; remote for heavy native |

---

## Acceptance criteria

### Server-agnostic browser IDE

- [ ] Cold boot with **no REH** → full editor, OPFS workspace, git  
- [ ] Run **Python** file via Pyodide without server  
- [ ] Run **Node/JS** via chosen WASM backend without server  
- [ ] Status clearly shows browser execution backend  

### Same-origin remote

- [ ] With REH: **Connect to Remote** from browser session  
- [ ] Tier 1: after attach, remote terminal works (R6-level echo)  
- [ ] Editor continuity: open files / layout restored (no blank restart)  
- [ ] No connection secrets in URL  
- [ ] Disconnect returns to browser capabilities (reload OK if state restored)  

### Stretch

- [ ] Switch **Run** target WASM ↔ remote **without** workbench reload  
- [ ] Spike-proven mid-session full remoteAuthority without reload (or documented impossible on pin)

---

## Risks

| Risk | Mitigation |
| --- | --- |
| Upstream forces reload on remoteAuthority | Tier 1 + execution-only remote (RA3); don’t block WASM |
| WebContainers license | Spike WB2a before committing; have QuickJS/worker fallback |
| Pyodide bundle size | Lazy-load on first Run; cache; document download cost |
| Dual FS on hybrid attach | Prefer single workspace FS; execution-only remote avoids dual roots |
| Scope creep (OIDC, CDN) | Enforce non-goals; same-origin only |

---

## PR stack (suggested)

| PR | Title | IDs |
| --- | --- | --- |
| 1 | `docs(adr): server-agnostic IDE + workspace sync` | SA0, SA1 |
| 2 | `feat(protocol): execution backend + connection state` | SA2 |
| 3 | `docs(spike): remote attach without reload` | RA0 |
| 4 | `feat(ext): zcode-runtime-core + python (Pyodide)` | WB0, WB1, WB4–5 slice |
| 5 | `feat(ext): zcode-remote connect + seamless Tier1 attach` | RA1, RA2, RA4 |
| 6 | `feat(ext): zcode-runtime-node` | WB2, WB3 |
| 7 | `test(e2e): attach + wasm run smoke` | RA5, WB6 |
| 8 | `feat: workspace export/import for remote open` | WS1–WS3 |

---

## Relationship to previous cross-origin plan

| Previous (XO*) | This plan |
| --- | --- |
| OQ10 dual-origin cookies | **Dropped** (same-origin OK) |
| Path A gateway | Optional ops note only |
| Path B connectCode | Not needed |
| Live attach / WASM | **New center of gravity** |

---

## Immediate next step after approval

1. Write **SA0 + SA1** ADRs under `docs/adr/`.  
2. Add **SA2** types to `@zcode/protocol`.  
3. Run **RA0** spike (document no-reload feasibility).  
4. Scaffold **`zcode-runtime-python`** + shared runtime interface (fastest user-visible “no server” win).  
5. Implement **`zcode-remote`** Tier 1 attach on same-origin.

No cross-origin server work unless product revisits that later.
