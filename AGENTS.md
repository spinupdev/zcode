# Agent guide — ZCode

You are working on **ZCode**, a dual-mode VS Code OSS browser IDE (repo may still be named `code-server`).

## Read first

1. **[`PLAN.md`](./PLAN.md)** — architecture diagrams, **done / in progress / remaining**, next queue, invariants  
2. [`README.md`](./README.md) — how to run  
3. [`docs/design-dual-mode-vscode-ide.md`](./docs/design-dual-mode-vscode-ide.md) — full design RFC  

## Product facts

- Brand: **ZCode** · CLI: **`zcode`** · not affiliated with [coder/code-server](https://github.com/coder/code-server)  
- UI always in the browser; dual-mode = `remoteAuthority` / EH / providers, not a custom editor RPC  
- Browser git needs **stateless** `/git-proxy` (CORS); not a control plane  
- Primary IDE: **`/ide/`** (VS Code Web). SPA **`/`** = git tools dogfood  

## Quick start

```bash
pnpm install && pnpm build
./scripts/fetch-vscode-web.sh
pnpm --filter @zcode/workbench build
pnpm --filter zcode-browser-fs build
node apps/cli/dist/cli.js web --dir apps/web/dist --port 5000
```

- SPA clone: http://127.0.0.1:5000/  
- VS Code Web: http://127.0.0.1:5000/ide/  

## Highest-priority remaining work

See **PLAN.md §5**. B7 and M3 (Playwright) are **done**. Default next: **M0d** owned web build or **R3b** REH attach.

## Rules

- Update **PLAN.md work tracker** when you finish or start a package  
- Atomic commits; no secrets in URLs  
- Prefer extensions/wrappers over VS Code core patches  
- Do not treat `@vscode/test-web` as production  

## Tests

```bash
pnpm test
pnpm e2e:browser
pnpm e2e:playwright   # needs Chromium: pnpm --filter @zcode/e2e install-browsers
```
