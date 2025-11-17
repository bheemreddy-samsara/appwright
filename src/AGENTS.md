# src Agent Guide

## 1. Package Identity
- Source of truth for `@samsara-dev/appwright` runtime APIs, fixtures, and types
- Emits `dist/**` via `npm run build`; consumers depend on these exports

## 2. Setup & Run
```bash
npm run lint
npm run build
npm test
```

## 3. Patterns & Conventions
- ✅ DO export public entry points through `src/index.ts` (e.g., `Device`, `defineConfig`)
- ✅ DO colocate shared contracts in `src/types/index.ts`; mirror usage in `src/fixture/index.ts`
- ✅ DO use `src/logger.ts` helpers when emitting logs (see `src/device/index.ts` warnings)
- ✅ DO post your plan before editing—maintainers require “share thoughts before edits” on every change
- ❌ DON’T write or edit generated JavaScript under `dist/**`; update the TypeScript sources instead
- ❌ DON’T introduce new raw `console.log`; legacy streaming in `src/providers/appium.ts` is the only exception

## 4. Touch Points / Key Files
- `src/index.ts` – package exports
- `src/config.ts` – `defineConfig` helper consumed by example projects
- `src/fixture/index.ts` – Playwright fixtures and persistent device lifecycle
- `src/device/index.ts` – Device abstraction sharing logger, vision, visual trace
- `src/types/index.ts` – shared enums and interfaces for providers, locators, and config

## 5. JIT Index Hints
- Find config shapes: `rg -n "interface AppwrightConfig" src/types` (fallback: `grep -rn "interface AppwrightConfig" src/types`)
- Trace public APIs: `rg -n "export {" src/index.ts` (fallback: `grep -rn "export {" src/index.ts`)
- Fixture hooks: `rg -n "test\.beforeEach" src/fixture` (fallback: `grep -rn "test\.beforeEach" src/fixture`)
- Logger usage: `rg -n "logger\." src` (fallback: `grep -rn "logger\." src`)

## 6. Common Gotchas
- `tsconfig.json` excludes `src/**/*.test.ts`; unit tests live in `src/tests/**`
- Remember to run `npm run build` after edits so `dist/` aligns for publishing
- Avoid importing from `dist/`; always use local TypeScript modules

## 7. Pre-PR Checks
```bash
npm run lint && npm run build && npm test
```
