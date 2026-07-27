# zcode-git

Browser-mode SCM + **multi-project** Open Repository for ZCode Web:

- **Open Repository…** — paste any HTTPS git URL (GitHub, GitLab, Bitbucket, Codeberg, self-hosted). Clones via isomorphic-git + same-origin `/git-proxy` into a **dedicated durable project** (`zcode-opfs:/workspace/<slug>/`), shows progress in notifications, then opens that folder.
- **First load** — if this browser has no projects, prompts to clone (or browse existing).
- **Browser Projects** view (Explorer sidebar) + **Manage Browser Projects…** — list, switch, delete projects that live in OPFS / IndexedDB.
- **Persistence** — files stay in OPFS (ZenFS primary) or IndexedDB `zcode-fs-v1`; last project id is stored in `localStorage` (`zcode.lastWorkspaceId`) so reopen / Cmd-Shift-T restores the same workspace. Bootstrap also calls `navigator.storage.persist()`.
- Welcome / Getting Started **Open Repository** is wired through `remoteHub.openRepository` → same ZCode clone flow.
- **Source control** view with change list, commit, push.

## Commands

| Command | Purpose |
| --- | --- |
| `zcode.git.openRepository` | Modal: paste URL → clone into a new browser project |
| `zcode.git.clone` | Alias of open repository |
| `zcode.git.manageProjects` | QuickPick: switch / clone / delete projects |
| `zcode.git.openProject` | Open a project by id (also used by the tree) |
| `zcode.git.deleteProject` | Remove a project from this browser only |
| `remoteHub.openRepository` | Welcome page entry → ZCode clone |
| `zcode.git.commit` / `push` / `refresh` | SCM |

## Private repos

1. Settings: `zcode.gitToken` + optional `zcode.gitUsername`, or
2. When clone returns 401/403, the extension prompts for a one-time PAT.

## Storage

Uses `@zcode/browser-agent` (`createBrowserAgentAsync`) so clones share OPFS/IDB with the debug SPA (`/debug/`) and `zcode-browser-fs`.

Both web extensions esbuild their own copy of the agent; they still share **one** durable store via realm globals (`__zcodeDefaultFsInfo__` / `__zcodeZenFsOpfs__`). After clone, `zcode.fs.revealWorkspace` swaps the folder (or reloads `/?workspace=<id>` if VS Code Web rejects the custom-scheme folder change).

**Why content can look “lost” after reopen:** always open the same origin (e.g. `127.0.0.1` vs `localhost` are different storage partitions). Private / ephemeral modes wipe OPFS and IndexedDB. Use **Browser Projects** or status-bar **repo** chip to pick a saved workspace.
