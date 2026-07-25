# Workspace sync — files-v1 (WS1)

Implements [ADR 0002](./adr/0002-browser-remote-workspace-sync.md) transport for same-origin attach.

## Format

```json
{
  "format": "files-v1",
  "workspaceId": "default",
  "files": {
    "hello.py": { "encoding": "utf8", "data": "print(1)\\n" },
    "bin/x": { "encoding": "base64", "data": "..." }
  }
}
```

| Limit | Value |
| --- | --- |
| Max payload | 25 MiB (server) / 20 MiB (client collect) |
| Max files | 5000 (server) / 2000 (client) |
| Paths | Relative only; no `..` |

## Routes (cookie auth)

| Method | Path | Role |
| --- | --- | --- |
| `POST` | `/v1/workspace/import` | Write map into `workspacePath` (REH folder) |
| `GET` | `/v1/workspace/export` | Read map from remote workspace |

## Client flow (`zcode-remote`)

### Connect (browser → remote)

1. Save dirty editors  
2. Walk `zcode-opfs` folder via `vscode.workspace.fs`  
3. `POST /v1/workspace/import`  
4. Reload `/?mode=remote&ready=1&authority=…`  

### Disconnect (remote → browser) — WS3

1. Save dirty editors  
2. `GET /v1/workspace/export`  
3. Write into `zcode-opfs:/workspace/<id>/` via `vscode.workspace.fs`  
4. Reload `/?mode=browser&workspace=<id>`  

Git bundle / tar can be added as additional `format` values later.
