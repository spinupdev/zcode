# zcode-browser-fs

Registers a `zcode-opfs` `FileSystemProvider` for browser-mode workspaces.

**Storage (B2b):**

1. **OPFS** via ZenFS (`@zenfs/dom` WebAccess) — primary  
2. **IndexedDB** `zcode-fs-v1` — fallback + one-shot migration source (B7)

Depends on `@zcode/browser-agent` for AgentFs, locking, and workspace layout.

See [docs/b2b-opfs-zenfs.md](../../docs/b2b-opfs-zenfs.md).
