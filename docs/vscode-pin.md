# VS Code pin

| Field | Value |
| --- | --- |
| **Policy** | Latest **stable** tag at kickoff (KD21) |
| **Tag** | `1.129.0` |
| **Commit SHA** | `125df4672b8a6a34975303c6b0baa124e560a4f7` |
| **Remote** | https://github.com/microsoft/vscode.git |
| **Submodule path** | `vendor/vscode` |
| **Pinned** | 2026-07-17 |

## Workflow

```bash
# First time (or CI):
./scripts/add-vscode-submodule.sh
./scripts/sync-vscode.sh

# After editing core (prefer not to):
export QUILT_PATCHES="$PWD/patches"
cd vendor/vscode
quilt new 0001-my-change.patch
# edit files
quilt refresh
cd ../..
# commit patches/ and series
```

## Rules

- **quilt** is the supported patch tool for `vendor/vscode` (code-server-style).
- Prefer product code in `packages/` and `extensions/` over core patches.
- Do **not** use `patch-package` on the submodule.
- Production web assets must be built from this pin (or a later intentional bump), never from `@vscode/test-web`.

## Builds

See [building-vscode.md](./building-vscode.md) for `scripts/build-server.sh` / `scripts/build-web.sh`.

## Upgrade procedure

1. Read VS Code release notes for web/server changes.
2. Bump submodule to new stable tag; update this file (tag + full SHA).
3. `quilt push -a`; fix conflicts; `quilt refresh`.
4. Rebuild web + server; run smoke suite.
5. Tag `zcode-x.y.z+vscode.a.b.c`.
