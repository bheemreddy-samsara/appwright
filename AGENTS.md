# Appwright Agent Guide

## 1. Project Snapshot
- **Repo type:** Single-package TypeScript library (no workspaces)
- **Stack:** Node.js ≥20, TypeScript, Playwright fixtures, Vitest, ESLint (`@empiricalrun`)
- **Docs:** Each major directory ships its own `AGENTS.md`; nearest file wins

## 2. Root Setup Commands
```bash
npm ci                # install dependencies (use npm install for incremental updates)
npm run lint          # ESLint with @empiricalrun rules
npm run build         # tsc --build (typecheck + emit to dist/)
npm test -- --run     # Vitest single pass (avoids interactive watch mode)
npm run changeset     # prepare release notes when changes ship
```

## 3. Universal Conventions
- Share a short plan with maintainers **before editing** (hard requirement)
- Author new code in `src/**`; never modify generated `dist/**`
- Rely on `src/logger.ts` instead of raw `console` (exceptions stream subprocess output only)
- Follow Conventional Commits (`feat:`, `fix:`, `chore:`) and branch from `main`
- Keep APIs backward compatible; prefer additive options over breaking changes
- Always generate a Changeset that captures the user-facing impact of the feature you worked on

## 4. Security & Secrets
- Never commit API keys, BrowserStack creds, or AWS secrets; load via environment variables
- BrowserStack needs `BROWSERSTACK_USERNAME` / `BROWSERSTACK_ACCESS_KEY`
- Remote build downloads require AWS credentials (`AWS_REGION` plus standard SDK env vars)
- Avoid storing PII or test artifacts in the repo; use external storage for logs/videos

## 5. JIT Index (what to open, not what to paste)

### Package Structure
- Core library: `src/` → [see src/AGENTS.md](src/AGENTS.md)
- Device runtime: `src/device/` → [see src/device/AGENTS.md](src/device/AGENTS.md)
- Providers (BrowserStack, LambdaTest, emulator, local): `src/providers/` → [see src/providers/AGENTS.md](src/providers/AGENTS.md)
- Vision utilities: `src/vision/` → [see src/vision/AGENTS.md](src/vision/AGENTS.md)
- Visual trace capture: `src/visualTrace/` → [see src/visualTrace/AGENTS.md](src/visualTrace/AGENTS.md)
- Test suite: `src/tests/` → [see src/tests/AGENTS.md](src/tests/AGENTS.md)
- Example consumer app: `example/` → [see example/AGENTS.md](example/AGENTS.md)

### Quick Find Commands
- Locate a public export: `rg -n "export .*" src/index.ts src/types` (fallback: `grep -rn "export .*" src/index.ts src/types`)
- Discover provider hooks: `rg -n "DeviceProvider" src/providers` (fallback: `grep -rn "DeviceProvider" src/providers`)
- Inspect Playwright fixtures: `rg -n "extend<TestLevelFixtures" src/fixture` (fallback: `grep -rn "extend<TestLevelFixtures" src/fixture`)
- Track vision helpers: `rg -n "AppwrightVision" src/vision` (fallback: `grep -rn "AppwrightVision" src/vision`)
- Find targeted tests: `rg -n "\\.spec\\.ts" src/tests` (fallback: `grep -rn "\.spec\.ts" src/tests`)

## 6. Definition of Done
- `npm run lint && npm run build && npm test -- --run` must all pass locally
- Add a Changeset entry for user-facing changes
- Ensure documentation in relevant `AGENTS.md` files reflects the update
- Confirm the plan was shared and acknowledged before merging