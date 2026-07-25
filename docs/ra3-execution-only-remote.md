# RA3 — Execution-only remote (no workbench reload)

## Goal

Run Node/Python on the **server workspace** while the editor stays in **browser mode** (`zcode-opfs`, no `remoteAuthority`).

## API

```http
POST /v1/exec
Cookie: zcode_sess=…
Content-Type: application/json

{
  "language": "javascript" | "typescript" | "python",
  "code": "console.log(1)",
  "relativePath": "optional/under/workspace.js",
  "timeoutMs": 30000
}
```

```json
{
  "ok": true,
  "exitCode": 0,
  "stdout": "...",
  "stderr": "...",
  "timedOut": false,
  "runner": ["node", "….js"]
}
```

- Requires authenticated cookie + configured workspace path (`zcode serve`).
- No free-form shell; fixed runners only.
- Temp files for inline `code` are written under OS temp and deleted after run.

## Client

Extension **`zcode-runtime-remote`** registers backend id `remote-reh` when `GET /v1/session` reports `executionOnly: true`.

Commands:

- **ZCode: Use Remote Execution (no reload)**
- **ZCode: Run File** (with that backend selected)

## vs full remote attach

| | RA3 exec-only | Tier 1 Connect |
| --- | --- | --- |
| Reload | No | Yes |
| Workspace FS | Browser OPFS | Server tree |
| Terminal (PTY) | No | Yes (REH) |
| Run File | Server node/python | Server + remote EH |
