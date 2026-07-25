# zcode-runtime-remote (RA3)

**Execution-only remote** — run Node/Python on the `zcode serve` workspace via `POST /v1/exec` without setting `remoteAuthority` or reloading the workbench.

| | |
| --- | --- |
| Backend id | `remote-reh` |
| Requires | Cookie session + server workspace path |
| Workspace FS | Stays `zcode-opfs` (browser) |

Commands:

- **ZCode: Use Remote Execution (no reload)**
- **ZCode: Refresh Remote Execution Backend**
