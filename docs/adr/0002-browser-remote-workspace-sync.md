# ADR 0002 — Browser ↔ remote workspace sync

| Field | Value |
| --- | --- |
| **Status** | Accepted |
| **Date** | 2026-07-18 |
| **IDs** | SA1 · PLAN P0 (workspace sync) |
| **Depends on** | ADR 0001 (server-agnostic IDE) |
| **Gates** | Tier 1 full remote workspace attach (RA2) with OPFS data preserved |

## Context

Browser mode stores workspaces under **OPFS** (primary) / IndexedDB fallback (`zcode-opfs`, agent store `zcode-fs-v1`).  
Remote mode opens a **server path** via `vscode-remote://<authority>/…`.

Today there is **no** automated path to move files between them. Cold remote boot starts on the server tree only. Users who edited in the browser lose continuity unless we export/import.

This ADR does **not** cover execution-only remote (run on REH while FS stays OPFS) — that needs **no** full sync.

## Decision

### 1. When sync runs

| Event | Sync? | Direction |
| --- | --- | --- |
| **Connect → full remote workspace** (Tier 1) | **Yes** | Browser → remote (export, then open remote folder) |
| **Disconnect → browser** | **Optional** | Remote → browser (import changed files) |
| Execution-only remote / WASM run | **No** | Workspace stays on client FS |
| Cold boot already remote | **No** | Server tree is source of truth |

### 2. Export format (browser → remote)

**Primary: git bundle** when the OPFS workspace is a git repo (common after clone/Open Repository).

```text
isomorphic-git → git bundle create - --all   (or equivalent file range)
POST /v1/workspace/import  (same-origin, cookie auth)
  body: application/octet-stream (bundle) or multipart
remote: git clone --mirror / bundle unbundle into session workspace
```

**Fallback: tar archive** of the workspace root (exclude `.git` only if bundle path used; include for tar if not a git repo).

| Format | Prefer when |
| --- | --- |
| **Git bundle** | `.git` present; preserves history + remotes metadata where practical |
| **Tar (ustar/pax)** | No git metadata; or bundle fails |

**Do not** invent a proprietary binary snapshot as v1.

### 3. Import format (remote → browser, optional detach)

- Prefer `git bundle` from remote if git repo.
- Else tar of remote workspace path (respect size limit).
- Import into OPFS workspace id (existing or new).
- Open `zcode-opfs:/workspace/<id>` after browser reload.

### 4. Conflict policy

| Case | Policy |
| --- | --- |
| Remote workspace **empty** / default seed | Export wins; unpack as remote root |
| Remote has **user content** | **Prompt**: Replace remote tree · Merge via git (if both git) · Cancel |
| Dirty editors pre-attach | **Must flush** to OPFS before export (block attach if save fails) |
| Size over `maxWorkspaceBytes` | Fail with clear error; suggest `.gitignore` / smaller export |

Default for automation / e2e: remote empty → replace without prompt.

### 5. Transport (same-origin)

- Authenticated with existing **HttpOnly `zcode_sess`** (no tokens in URL).
- Endpoints (illustrative; implement under `packages/server`):

```http
POST /v1/workspace/export-ready   # optional: server prepares empty dir
POST /v1/workspace/import         # body = bundle or tar; query ?format=bundle|tar
GET  /v1/workspace/export         # detach: download bundle/tar from remote
```

- Rate-limit and max body size (align with `ProductCapabilities.maxWorkspaceBytes`).
- Never log file contents; redact paths if sensitive.

### 6. Continuity across Tier 1 reload

1. Save all dirty editors to OPFS.  
2. Export bundle/tar → import on server (or stage for post-boot import).  
3. Store **client continuity cookie/localStorage flags** (non-secret): workspace id, open editors list if needed.  
4. Reload to `/?mode=remote&ready=1&authority=<host>` (no secrets).  
5. Remote workbench opens imported path; layout restored via VS Code storage when possible.

Exact import-before-vs-after reload is an implementation detail; acceptance is: **user files from OPFS appear on remote after attach**.

### 7. Non-goals

- Live bidirectional sync / CRDT while dual-open.
- LFS / submodules / SSH remotes in export v1.
- Cross-origin upload APIs.
- Perfect merge UI (v1 prompt + git merge is enough).

## Consequences

**Positive**

- Full remote attach can preserve browser work.
- Format is portable (bundle/tar) and debuggable.
- Execution-only and WASM paths stay simple (no sync).

**Trade-offs**

- Large workspaces may be slow/heavy in browser memory — enforce size limits.
- Bundle generation in pure JS may need streaming / worker (use browser-agent patterns).

**Follow-ups**

- WS1–WS3 implementation after `zcode-remote` Tier 1 skeleton.
- E2E: browser edit → attach → file exists on remote.

## Alternatives considered

| Alternative | Why not v1 |
| --- | --- |
| rsync-over-WS custom protocol | More code; less portable |
| Always re-clone from GitHub | Fails offline / private / unpushed work |
| IndexedDB dump raw | Opaque; hard to open on server |
