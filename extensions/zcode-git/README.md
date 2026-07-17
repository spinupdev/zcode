# zcode-git

Browser-mode SCM + **Open Repository** for ZCode Web:

- **Open Repository…** — paste any HTTPS git URL (GitHub, GitLab, Bitbucket, Codeberg, self-hosted). Clones via isomorphic-git + same-origin `/git-proxy`, shows progress in VS Code notifications, then opens `zcode-opfs:/workspace/<id>`.
- Welcome / Getting Started **Open Repository** is wired through `remoteHub.openRepository` → same ZCode clone flow (no Microsoft Remote Hub).
- **Source control** view with change list (statusMatrix)
- **Commit** from the SCM input box
- **Push** through `/git-proxy` (optional PAT in settings)

## Commands

| Command | Purpose |
| --- | --- |
| `zcode.git.openRepository` | Modal: paste URL → clone with notification progress |
| `zcode.git.clone` | Alias of open repository |
| `remoteHub.openRepository` | Welcome page entry → ZCode clone |
| `zcode.git.commit` / `push` / `refresh` | SCM |

## Private repos

1. Settings: `zcode.gitToken` + optional `zcode.gitUsername`, or
2. When clone returns 401/403, the extension prompts for a one-time PAT.

## Storage

Uses `@zcode/browser-agent` (`createBrowserAgentAsync`) so clones share OPFS/IDB with the debug SPA (`/debug/`) and `zcode-browser-fs`.
