# zcode-remote

Same-origin **Connect / Disconnect** for ZCode remote REH (RA1 / RA2 Tier 1).

| Command | Behavior |
| --- | --- |
| **ZCode: Connect to Remote** | Save editors → require cookie session → reload `?mode=remote&ready=1&authority=…` |
| **ZCode: Disconnect Remote** | Reload browser mode |
| **ZCode: Remote Connection Status** | Writes session + mode diagnostics to **Output → ZCode Remote** (status-bar click) |
| **ZCode: Upgrade Workspace to Remote** | Alias of Connect (workspace export later / ADR 0002) |

See [docs/plan-server-agnostic-ide.md](../../docs/plan-server-agnostic-ide.md).
