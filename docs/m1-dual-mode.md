# M1 — Dual-mode workbench (`remoteAuthority`)

## Model

| Mode | `remoteAuthority` | Workspace | Terminal | EH |
| --- | --- | --- | --- | --- |
| Browser | unset | `zcode-opfs:/workspace/<id>` | off (chrome soft-hide) | Web only |
| Remote | `host:port` (same-origin) | `vscode-remote://…` | on (REH PTY) | Web + Remote |

No custom `zcode+` resolver in MVP. Cookie session maps to REH connection-token (R3b).

## Product payload

`GET /product.json?mode=browser|remote&authority=host:port&workspace=id`  
(Legacy: `/ide/product.json` — same payload.)

Built by `@zcode/shell` `buildWorkbenchCreateOptions`:

- `zcodeMode`, `zcodeCapabilities`
- `configurationDefaults` (terminal soft-hide in browser)
- `additionalBuiltinExtensions` (browser-fs, git, diagnostics)
- **Never** includes connection tokens

## Bootstrap

`apps/workbench` bootstrap:

1. Fetch `/product.json` + query
2. Remote: require `/v1/session` authenticated when serve is used; default authority = host
3. Load owned esbuild or dogfood AMD workbench
4. `create(body, window.product)`

## Dogfood

```bash
# Browser
http://127.0.0.1:5000/?workspace=default

# Remote (after login + REH artifact)
node apps/cli/dist/cli.js serve . --port 8080 --password secret
# open /?mode=remote&authority=127.0.0.1:8080&ready=1
```

## Related

- [reh-cookie-proxy.md](./reh-cookie-proxy.md)
- [r6-terminal-e2e.md](./r6-terminal-e2e.md)
- [m2-diagnostics-csp.md](./m2-diagnostics-csp.md)
