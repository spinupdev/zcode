# Spike RA0 — Remote attach without workbench reload

| Field | Value |
| --- | --- |
| **Status** | **Concluded (go/no-go)** |
| **Date** | 2026-07-18 |
| **Related** | ADR 0001 · RA* · pin [`docs/vscode-pin.md`](../vscode-pin.md) |

## Question

Can VS Code Web (pin **1.129**) mid-session set `remoteAuthority` / open `vscode-remote://` **without** a full workbench reload?

## Conclusion (normative for this pin)

| Path | No-reload? | Product decision |
| --- | --- | --- |
| **Execution backends** (WASM Run File) | **Yes** | **Ship** — default for Run without REH |
| **Tier 1 full remote workspace** | **No** (reload required) | **Ship** — state-preserving reload + files-v1 sync (WS1/WS3) |
| **Execution-only remote (RA3)** | **Partial yes** | **Later** — PTY/tasks via REH while OPFS stays local; no `remoteAuthority` flip |
| **True mid-session remoteAuthority** | **No-go on pin 1.129 without core patches** | Do **not** invest in quilt for this yet |

### Rationale

1. Workbench `create({ remoteAuthority })` is a **bootstrap-time** option in OSS web (`apps/workbench` + shell product). Changing it is not a supported public API mid-session.  
2. Opening `vscode-remote://` folders in desktop VS Code typically triggers a **window reload**; web follows the same remote connection lifecycle.  
3. We already deliver continuity without mid-session authority flip:
   - **Save dirty → files-v1 upload → reload remote** (`zcode-remote` Connect)
   - **Export → OPFS write → reload browser** (`zcode-remote` Disconnect / WS3)
   - **Run File** via `zcode-runtime-*` never reloads  

### Experiments (code + product path — filled)

| # | Experiment | Result |
| --- | --- | --- |
| 1 | Cold boot `?mode=remote` after cookie | Works (M1/R6) |
| 2 | Mid-session Connect command | Implemented as **controlled reload** (Tier 1) — intentional |
| 3 | Dynamic `RemoteAuthorityResolver` mid-session | **Deferred** — would need web-specific support + likely reload on first connect |
| 4 | Multi-root OPFS + remote folder without reload | **Not pursued** — dual FS complexity; execution-only remote is cleaner for RA3 |

### Exit criteria

- [x] Document go/no-go for Tier 2 workspace attach  
- [x] Ship Tier 1 + WASM as permanent strategy for pin 1.129  
- [x] Gate RA3 as **execution-only** (no remoteAuthority), not full workspace attach  

## Product strategy (locked)

```text
Default: browser mode + WASM Run
Optional: Connect → reload → full remote workspace (sync files-v1)
Future:  RA3 execution-only remote (no reload) for PTY/tasks only
Never:   require server for basic edit/run
```

## References

- ADR 0001 — server-agnostic IDE  
- ADR 0002 — workspace sync  
- `docs/workspace-sync-files-v1.md`  
- `docs/m1-dual-mode.md` · `docs/reh-cookie-proxy.md`  
