# Vision Module Guide

## 1. Package Identity
- Provides `AppwrightVision` wrappers around LLM-powered image interactions
- Bridges device screenshots with `@empiricalrun/llm` models for beta tap flows

## 2. Setup & Run
```bash
npm run build
npm test -- src/tests/device.spec.ts
```

## 3. Patterns & Conventions
- ✅ DO instantiate vision helpers through `new VisionProvider(device, client)` (`src/vision/index.ts`)
- ✅ DO guard beta APIs behind the existing `Device.beta` namespace (see `src/device/index.ts`)
- ✅ DO share your proposed changes before editing—vision code is experimental
- ❌ DON’T hardcode model IDs; reuse constants defined in `src/vision/index.ts`
- ❌ DON’T block on long-running LLM calls; favor async/await patterns already present

## 4. Touch Points / Key Files
- `src/vision/index.ts` – `AppwrightVision` and `VisionProvider` implementations
- `src/device/index.ts` – consumes vision helpers inside `Device.beta`
- `src/utils.ts` – provides helpers like `boxedStep` used around vision actions

## 5. JIT Index Hints
- Find vision exports: `rg -n "AppwrightVision" src/vision` (fallback: `grep -rn "AppwrightVision" src/vision`)
- Trace beta tap usage: `rg -n "beta =" src/device/index.ts` (fallback: `grep -rn "beta =" src/device/index.ts`)
- Locate LLM imports: `rg -n "@empiricalrun/llm" src` (fallback: `grep -rn "@empiricalrun/llm" src`)

## 6. Common Gotchas
- Vision helpers expect `device.takeScreenshot()`; ensure provider implements screenshot capability
- Keep beta APIs optional—avoid breaking existing stable flows
- Tests rely on mocking; update `src/tests/device.spec.ts` when altering beta behavior

## 7. Pre-PR Checks
```bash
npm test -- src/tests/device.spec.ts
```
