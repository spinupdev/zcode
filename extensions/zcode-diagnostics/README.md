# zcode-diagnostics

Command **ZCode: Copy Diagnostics Report** (`zcode.diagnostics.copyReport`) copies a JSON snapshot:

- mode (`browser` | `remote`)
- capabilities (terminal, search, …)
- workspace folder URIs
- optional storage estimate
- redacted page URL (no `tkn` / `connectionToken` / passwords)

Does **not** include connection tokens or session cookies (KD12).

## Build

```bash
pnpm --filter zcode-diagnostics build
```

Loaded as a builtin web extension via `/extensions/zcode-diagnostics` from the workbench host.
