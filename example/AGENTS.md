# Example Project Guide

## 1. Package Identity
- Minimal consumer app showing how to configure and run Appwright tests locally
- Uses the published package via `@samsara-dev/appwright` dev dependency

## 2. Setup & Run
```bash
cd example
npm install
npm run extract:app        # prepare Wikipedia sample binaries
# Configure device providers via appwright.config.ts
```

## 3. Patterns & Conventions
- ✅ DO treat `example/appwright.config.ts` as reference for project definitions and providers
- ✅ DO use fixtures from the package (`import { test, expect } from "@samsara-dev/appwright"`)
- ✅ DO share your plan before editing—example changes should be intentional and lightweight
- ❌ DON’T copy compiled files from root `dist/`; depend on npm package APIs instead
- ❌ DON’T commit downloaded app binaries; `.gitignore` already excludes them

## 4. Touch Points / Key Files
- `example/appwright.config.ts` – sample multi-project config (iOS + Android emulator)
- `example/tests/tests.spec.ts` – walkthrough of typical device interactions
- `example/tools/extract.js` – helper for unpacking iOS build archives
- `example/package.json` – scripts and dependency wiring

## 5. JIT Index Hints
- Locate tests: `rg -n "test\(" example/tests` (fallback: `grep -rn "test(" example/tests`)
- Inspect config options: `rg -n "Platform" example/appwright.config.ts` (fallback: `grep -rn "Platform" example/appwright.config.ts`)
- Review tooling: `rg -n "extractApp" example/tools/extract.js` (fallback: `grep -rn "extractApp" example/tools/extract.js`)

## 6. Common Gotchas
- Sample config expects emulator providers; ensure local Android/iOS tooling exists before running
- Keep example dependency aligned with root version when publishing
- Avoid heavy dependencies here—example should stay lean

## 7. Pre-PR Checks
```bash
cd example && npm install && npm run extract:app
```
