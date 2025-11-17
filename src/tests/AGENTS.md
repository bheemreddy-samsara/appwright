# Tests Guide

## 1. Package Identity
- Vitest suite covering device behavior, locators, regex utilities, and visual trace service
- Uses Playwright shims to emulate fixtures when running outside Playwright

## 2. Setup & Run
```bash
npm test -- --run
npm test -- --run src/tests/device.spec.ts
npm test -- --run src/tests/browserstack.s3.spec.ts
```

## 3. Patterns & Conventions
- ✅ DO mock WebDriver and provider dependencies with `vi.fn()` (see `src/tests/device.spec.ts`)
- ✅ DO colocate new specs under `src/tests` with `.spec.ts` suffix
- ✅ DO reset Vitest mocks in `afterEach` to keep tests isolated
- ✅ DO share your intended changes before editing or adding tests
- ✅ DO run Vitest with `--run` in automation to avoid watch-mode prompts
- ❌ DON’T import from `dist/`; always target `src/**` modules
- ❌ DON’T rely on real network calls—mock fetch, S3, and other clients (see `browserstack.s3.spec.ts`)

## 4. Touch Points / Key Files
- `src/tests/device.spec.ts` – lifecycle, iOS settings, persistent sync coverage
- `src/tests/locator.spec.ts` – locator timeout behavior
- `src/tests/visual-trace.service.spec.ts` – trace service expectations
- `src/tests/browserstack.s3.spec.ts` – S3 download helper mocks
- `src/tests/vitest.config.mts` – Vitest configuration entry point

## 5. JIT Index Hints
- Find all specs: `rg -g "*.spec.ts" --files src/tests` (fallback: `find src/tests -name "*.spec.ts"`)
- Search mocked dependencies: `rg -n "vi\.mock" src/tests` (fallback: `grep -rn "vi\.mock" src/tests`)
- Inspect Playwright shims: `rg -n "playwrightTest" src/tests/device.spec.ts` (fallback: `grep -rn "playwrightTest" src/tests/device.spec.ts`)

## 6. Common Gotchas
- Vitest config disables parallel workers for certain specs; respect existing `vi.mock` patterns
- Reset environment variables after each test when stubbing (`browserstack.s3.spec.ts` example)
- Update snapshots? (none currently); prefer explicit assertions over snapshots

## 7. Pre-PR Checks
```bash
npm test && npm run lint
```
