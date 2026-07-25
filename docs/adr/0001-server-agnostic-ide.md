# ADR 0001 — Server-agnostic IDE (same-origin, pluggable backends)

| Field | Value |
| --- | --- |
| **Status** | Accepted |
| **Date** | 2026-07-18 |
| **IDs** | SA0 · product north star |
| **Supersedes** | Cross-origin CDN remote priority (OQ10 deferred) |

## Context

ZCode already supports:

1. **Browser mode** — VS Code Web + OPFS/IDB + isomorphic-git + `/git-proxy` (no REH).
2. **Remote mode** — same-origin `zcode serve` co-serves shell + cookie-auth REH proxy (cold boot via `?mode=remote`).

Product direction:

- The IDE must **not depend on a server**.
- Users should **run Node/Python in the browser** (WASM) without REH.
- Users should **attach to a remote** on the **same origin / same site** when available.
- Prefer **extensions** for attach and runtimes; avoid custom editor RPC (KD2).
- **Cross-origin** shell ≠ runtime is **out of scope** for now (user OK with same origin).

## Decision

### 1. North star

| Always | Optional |
| --- | --- |
| Browser workbench UI | REH / remote EH / native LSPs |
| Client workspace FS (`zcode-opfs`) | Full remote workspace FS |
| Browser execution backends (WASM) | Remote PTY / remote run |
| Browser git | System git on server |

**Default boot is browser mode** (`remoteAuthority` unset). Absence of REH is a normal, polished product state.

### 2. Topology: same-origin only

```text
Browser ──same origin──► zcode serve (or static shell + co-served REH proxy)
                           ├ / + /vscode + /extensions
                           ├ /login · /v1/session · cookie zcode_sess
                           └ REH reverse proxy ──loopback──► REH
```

- Attach authority = `location.host` when co-served.
- Cookie model stays HttpOnly + `SameSite=Lax` (R3b).
- **OQ10 / cross-origin CDN shell** deferred; not on the critical path.

### 3. Pluggable backends (not two products)

Two independent axes:

| Axis | Owners | Examples |
| --- | --- | --- |
| **Execution backend** | Web extensions | `browser-python` (Pyodide), `browser-node` (WASM/WC), `remote-reh` |
| **Connection scope** | Web extensions + shell | `none` · `execution` (PTY/tasks only) · `workspace` (full remoteAuthority) |

Day-to-day **Run** goes through an execution-backend registry so WASM vs remote is a setting/command, not a reinstall.

Do **not** invent a product BackendFacade for file/terminal/EH IPC. Full remote workspace still uses upstream VS Code remote protocol when `scope=workspace`.

### 4. Remote attach quality tiers

| Tier | Behavior | When |
| --- | --- | --- |
| **Tier 1 (ship first)** | Connect → flush dirty → **controlled reload** with state restore → remote workbench | Full remote workspace open |
| **Tier 2 (stretch)** | Switch run target / execution-only remote **without** workbench reload | Default “Run” UX; spike-gated for full authority |

Upstream VS Code often requires reload when changing `remoteAuthority` at `create()`. We do not block the roadmap on zero-reload full remote.

### 5. Extension map (normative)

| Extension | Role |
| --- | --- |
| `zcode-browser-fs` | OPFS FS (exists) |
| `zcode-git` | Browser SCM (exists) |
| `zcode-diagnostics` | Mode / backend status (extend) |
| `zcode-remote` | Connect / disconnect / Tier 1 attach (from upgrade stub) |
| `zcode-runtime-python` | Pyodide |
| `zcode-runtime-node` | Node/JS in browser |
| `zcode-runtime-core` (optional) | Shared registry + Run commands |

### 6. Security (unchanged)

- No connection secrets in URLs (KD12).
- `ConnectionHandle` = `{ ready, authority }` only — never a token string in workbench options.

## Consequences

**Positive**

- Clear product story: works offline/static; server is an optional upgrade.
- WASM and remote can land on independent PR tracks.
- Reuses same-origin cookie + REH work already done.

**Trade-offs**

- Full remote open may still reload once (Tier 1) until spike proves otherwise.
- Browser runtimes will not match native Node/pip completeness; document limits; use remote for heavy native.

**Follow-ups**

- SA1 — workspace sync ADR (gates Tier 1 full remote open with OPFS data).
- SA2 — protocol types for backends + connection state.
- RA0 — no-reload spike.
- WB* — Python/Node runtimes.
- RA* — `zcode-remote` extension.

## Rejected alternatives

| Alternative | Why rejected (now) |
| --- | --- |
| Cross-origin CDN shell + connectCode | User chose same-origin; cookie complexity high |
| Custom file/terminal RPC bus | Violates KD2; fights VS Code |
| Server-required product | Contradicts north star |
| Cold-boot-only remote forever | Poor UX for “attach without starting over” |
