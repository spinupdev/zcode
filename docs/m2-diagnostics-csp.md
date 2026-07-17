# M2 — Diagnostics, CSP, log redaction

## Diagnostics extension

`extensions/zcode-diagnostics` — command **ZCode: Copy Diagnostics Report**.

```bash
pnpm --filter zcode-diagnostics build
```

Report JSON includes mode, capabilities, workspace folders, storage estimate, redacted `href`. No tokens/cookies.

## CSP

`packages/server` applies a draft CSP on HTML responses (`applySecurityHeaders`):

- `default-src 'self'`
- `script-src` allows `wasm-unsafe-eval` + `unsafe-eval` (VS Code Web)
- `connect-src 'self' https: wss: ws:`
- Open VSX in `extension-src` (optional)

Tune per pin in [design-dual-mode-vscode-ide.md](./design-dual-mode-vscode-ide.md) §CSP.

## Log redaction

```ts
import { redactSecrets, safeJsonStringify } from '@zcode/server';

safeJsonStringify({ url: '/x?connectionToken=secret' });
// → connectionToken=[REDACTED]
```

Keys: `password`, `connectionToken`, `tkn`, `Authorization`, `zcode_sess`, …

## Tests

```bash
pnpm --filter @zcode/server test   # csp + redact
pnpm e2e:playwright                # dual-mode product assertions (M1)
```
