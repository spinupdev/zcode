# zcode-git

Browser-mode SCM for ZCode Web (B8):

- **Source control** view with change list (statusMatrix via isomorphic-git)
- **Commit** from the SCM input box
- **Push** through same-origin `/git-proxy` (optional PAT in settings)
- **Clone** deep-links to the SPA autoclone flow (shared IDB `zcode-fs-v1`)

Uses `@zcode/browser-agent` + `IdbFs` so clones from `/` appear under `/ide/?workspace=<id>`.
