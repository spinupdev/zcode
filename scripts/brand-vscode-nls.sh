#!/usr/bin/env bash
# Rebrand walkthrough / welcome NLS strings from "VS Code" → "ZCode" in staged
# dist/vscode-web (dogfood npm or owned build). Safe to re-run (idempotent).
#
# Does not rewrite every VS Code mention in core settings/docs — only user-facing
# Getting Started walkthrough titles and related copy shown on first run.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT="${1:-${ROOT}/dist/vscode-web}"

log() { printf '==> %s\n' "$*"; }

if [[ ! -d "${OUT}/out" ]]; then
  log "skip brand-vscode-nls: no ${OUT}/out"
  exit 0
fi

python3 - "${OUT}" <<'PY'
import json
import pathlib
import sys

out = pathlib.Path(sys.argv[1])

# Exact string replacements for walkthrough / welcome chrome (NLS messages).
# Order: longer / more specific first where prefixes overlap.
REPLACEMENTS: list[tuple[str, str]] = [
    ("Get Started with VS Code for the Web", "Get Started with ZCode for the Web"),
    ("Get started with VS Code", "Get started with ZCode"),
    ("Setup VS Code Web", "Setup ZCode Web"),
    ("Setup VS Code Accessibility", "Setup ZCode Accessibility"),
    ("Setup VS Code", "Setup ZCode"),
    (
        "Learn the tools and shortcuts that make VS Code accessible. Note that some actions are not actionable from within the context of the walkthrough.",
        "Learn the tools and shortcuts that make ZCode accessible. Note that some actions are not actionable from within the context of the walkthrough.",
    ),
    (
        "Extensions are VS Code's power-ups. A growing number are becoming available in the web.",
        "Extensions are ZCode's power-ups. A growing number are becoming available in the web.",
    ),
    (
        "Extensions are VS Code's power-ups. They range from handy productivity hacks, expanding out-of-the-box features, to adding completely new capabilities.",
        "Extensions are ZCode's power-ups. They range from handy productivity hacks, expanding out-of-the-box features, to adding completely new capabilities.",
    ),
    (
        "Run commands without reaching for your mouse to accomplish any task in VS Code.",
        "Run commands without reaching for your mouse to accomplish any task in ZCode.",
    ),
    (
        "You're all set to start coding. You can open a local project or a remote repository to get your files into VS Code.",
        "You're all set to start coding. You can open a local project or a remote repository to get your files into ZCode.",
    ),
    (
        "Watch the first in a series of short & practical video tutorials for VS Code's key features.",
        "Watch the first in a series of short & practical video tutorials for ZCode's key features.",
    ),
    ("Browse Marketplace is not available in VS Code for the Web.", "Browse Marketplace is not available in ZCode for the Web."),
]


def brand_text(s: str) -> tuple[str, int]:
    n = 0
    for old, new in REPLACEMENTS:
        if old in s:
            count = s.count(old)
            s = s.replace(old, new)
            n += count
    return s, n


total = 0
touched: list[str] = []

# nls.messages.json — array of English strings
msg_json = out / "out" / "nls.messages.json"
if msg_json.is_file():
    data = json.loads(msg_json.read_text(encoding="utf-8"))
    if isinstance(data, list):
        new_list = []
        file_hits = 0
        for item in data:
            if isinstance(item, str):
                branded, n = brand_text(item)
                file_hits += n
                new_list.append(branded)
            else:
                new_list.append(item)
        if file_hits:
            msg_json.write_text(json.dumps(new_list, ensure_ascii=False), encoding="utf-8")
            total += file_hits
            touched.append(str(msg_json.relative_to(out)))

# nls.messages.js — globalThis._VSCODE_NLS_MESSAGES=[...]
msg_js = out / "out" / "nls.messages.js"
if msg_js.is_file():
    text = msg_js.read_text(encoding="utf-8")
    branded, n = brand_text(text)
    if n:
        msg_js.write_text(branded, encoding="utf-8")
        total += n
        touched.append(str(msg_js.relative_to(out)))

# Owned esbuild may inline some default strings; brand workbench bundles lightly.
for pattern in (
    "out/vs/workbench/workbench.web.main.internal.js",
    "out/vs/workbench/workbench.web.main.js",
):
    p = out / pattern
    if not p.is_file():
        continue
    text = p.read_text(encoding="utf-8", errors="surrogateescape")
    branded, n = brand_text(text)
    if n:
        p.write_text(branded, encoding="utf-8", errors="surrogateescape")
        total += n
        touched.append(str(p.relative_to(out)))

if total:
    print(f"branded {total} walkthrough string occurrence(s) in: {', '.join(touched)}")
else:
    print("brand-vscode-nls: nothing to replace (already branded or strings missing)")
PY

log "brand-vscode-nls done → ${OUT}"
