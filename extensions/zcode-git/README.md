# zcode-git

Browser-mode SCM for ZCode Web (B8):

- **Source control** view with change list (statusMatrix via isomorphic-git)
- **Commit** from the SCM input box
- **Push** through same-origin `/git-proxy` (optional PAT in settings)
- **Clone** deep-links to the SPA autoclone flow (shared OPFS/IDB)

Uses `@zcode/browser-agent` (`createBrowserAgentAsync`) so clones from `/` appear under `/ide/?workspace=<id>` on the same durable store (OPFS primary, IDB fallback).
