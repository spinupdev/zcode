# B2b — ZenFS + OPFS primary store

## Goal

Browser-mode workspaces use **Origin Private File System (OPFS)** via **ZenFS** (`@zenfs/core` + `@zenfs/dom` WebAccess) as the **primary** durable store. IndexedDB `zcode-fs-v1` remains the **fallback** and migration source (B7 bridge).

Scheme stays **`zcode-opfs://workspace/<id>/...`** (name is historical).

## Preference order

| Priority | Backend | When |
| --- | --- | --- |
| 1 | OPFS + ZenFS WebAccess | `navigator.storage.getDirectory()` available |
| 2 | IndexedDB `zcode-fs-v1` | OPFS missing or ZenFS configure fails |
| 3 | MemoryFs | Node tests / no browser storage |

## Path layout (unchanged)

AgentFs keys (no leading slash):

```text
workspace/<id>/...
workspace/<id>/.zcode-workspace.json
workspace/<id>/.git/...
```

OPFS root directory handle: `zcode-workspaces/` under the origin private root.
ZenFS absolute paths: `/workspace/<id>/...`.

## API (`@zcode/browser-agent`)

```ts
import {
  createDefaultFs,        // sync: IDB → Memory (no OPFS wait)
  createDefaultFsAsync,   // async: OPFS → IDB → Memory
  createDefaultFsInfo,    // { fs, kind: 'opfs'|'idb'|'memory' }
  createBrowserAgentAsync,
  createZenFsOpfs,
  createZenFsMemory,      // unit tests
  migrateIdbToFs,
  isOpfsAvailable,
} from '@zcode/browser-agent';
```

## Migration

On first OPFS open, `migrateIdbToFs` copies `workspace/*` (and other keys) from IDB when OPFS is empty. Safe to call repeatedly (no-op when dest has content).

## Consumers

| Surface | Behavior |
| --- | --- |
| SPA `apps/web` | `createBrowserAgentAsync` before clone persist |
| `zcode-browser-fs` | Register scheme immediately on IDB; swap backing store to OPFS when ready |
| `zcode-git` | Same upgrade path for SCM |

## Tests

```bash
pnpm --filter @zcode/browser-agent test
# includes ZenFsAgentFs InMemory + migrate skip on Node
```

## Limits (honest)

- Multi-tab: coarse consistency; no cross-tab lock beyond WorkspaceLock in one realm.
- Safari OPFS/worker quirks: if OPFS configure fails, IDB still works.
- SPA git clone still runs in a MemoryFs worker, then imports into main-thread AgentFs (OPFS/IDB).
- Full git-worker dual-open OPFS is deferred (design: single FS coordinator worker).

## Related

- [design-dual-mode-vscode-ide.md](./design-dual-mode-vscode-ide.md) § ZenFS + OPFS
- PLAN.md tracker **B2b**
