# Device Module Guide

## 1. Package Identity
- Implements the `Device` class that wraps WebDriver clients with Appwright-specific helpers
- Coordinates vision, persistent sync, boxed steps, and provider integrations

## 2. Setup & Run
```bash
npm run build
npm test -- src/tests/device.spec.ts
```

## 3. Patterns & Conventions
- ✅ DO wrap interactions in `boxedStep` (see `Device.backgroundApp` in `src/device/index.ts`)
- ✅ DO send provider syncs through `this.safeSync` (`preparePersistentTest` / `finalizePersistentTest`)
- ✅ DO surface logs via `logger.warn` / `logger.log` for recoverable issues (see persistent lifecycle handlers)
- ✅ DO share your edit plan with maintainers before touching this module
- ❌ DON’T spawn WebDriver sessions here—providers own session creation (`src/providers/index.ts`)
- ❌ DON’T bypass persistent lifecycle helpers; always call `preparePersistentTest`/`finalizePersistentTest`

## 4. Touch Points / Key Files
- `src/device/index.ts` – full `Device` implementation and `beta` utilities
- `src/utils.ts` – utilities like `boxedStep` leveraged by device methods
- `src/visualTrace/service.ts` – interacts through `initializeVisualTrace`
- `src/providers/browserstack/index.ts` – injects provider-specific behavior consumed by `Device`
- `src/tests/device.spec.ts` – regression coverage for lifecycle and iOS settings

## 5. JIT Index Hints
- Locate lifecycle hooks: `rg -n "preparePersistentTest" src/device/index.ts` (fallback: `grep -rn "preparePersistentTest" src/device/index.ts`)
- Find visual trace usage: `rg -n "initializeVisualTrace" src/device` (fallback: `grep -rn "initializeVisualTrace" src/device`)
- Inspect beta helpers: `rg -n "beta =" src/device/index.ts` (fallback: `grep -rn "beta =" src/device/index.ts`)
- Track provider sync: `rg -n "safeSync" src/device/index.ts` (fallback: `grep -rn "safeSync" src/device/index.ts`)

## 6. Common Gotchas
- `device.updateAppSettings` only supports iOS BrowserStack sessions; keep error messaging clear
- Persistent sync relies on `device.attachDeviceProvider`; ensure providers set it before use
- Update accompanying tests in `src/tests/device.spec.ts` whenever lifecycle behavior changes

## 7. Pre-PR Checks
```bash
npm test -- src/tests/device.spec.ts && npm run build
```
