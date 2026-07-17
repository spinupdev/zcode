# Quilt workflow (vendor/vscode)

ZCode applies VS Code changes via a **quilt patch series** under `patches/`, matching [coder/code-server](https://github.com/coder/code-server) integration mechanics—not an in-tree OpenVSCode-style fork.

## Install quilt

```bash
# macOS
brew install quilt

# Debian/Ubuntu
sudo apt-get install quilt
```

If quilt is missing, `scripts/sync-vscode.sh` falls back to `git apply` for CI smoke of a non-empty series.

## Environment

```bash
export QUILT_PATCHES="$PWD/patches"
```

Series file: `patches/series` (one patch filename per line; `#` comments allowed).

## Common commands

| Command | Purpose |
| --- | --- |
| `./scripts/sync-vscode.sh` | Submodule init + apply all patches |
| `quilt series` | List series (run inside `vendor/vscode` with `QUILT_PATCHES` set) |
| `quilt push -a` | Apply all |
| `quilt pop -a` | Unapply all |
| `quilt new 000N-name.patch` | Start a new patch |
| `quilt refresh` | Write file diffs into current patch |

## Policy

- Keep the series **minimal**.
- Prefer wrappers (`packages/server`), shell (`packages/shell`), and extensions (`extensions/zcode-*`).
- Empty series is valid and expected for early PRs.
