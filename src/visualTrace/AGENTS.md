# Visual Trace Guide

## 1. Package Identity
- Captures and persists screenshot traces for retries via `VisualTraceService`
- Integrated by `Device.initializeVisualTrace` to support reporting tooling

## 2. Setup & Run
```bash
npm run build
npm test -- src/tests/visual-trace.service.spec.ts
```

## 3. Patterns & Conventions
- ✅ DO use `initializeVisualTrace` / `clearVisualTraceService` helpers from `src/visualTrace/service.ts`
- ✅ DO emit telemetry through `logger` for trace lifecycle events
- ✅ DO share your plan for changes before editing—visual trace is critical to debugging
- ❌ DON’T persist large buffers globally; use scoped service instances like `VisualTraceService`
- ❌ DON’T introduce synchronous file I/O on hot paths; prefer async helpers already implemented

## 4. Touch Points / Key Files
- `src/visualTrace/service.ts` – core service implementation
- `src/visualTrace/index.ts` – exports for consumers
- `src/device/index.ts` – integrates visual trace with device lifecycle
- `src/tests/visual-trace.service.spec.ts` – regression coverage

## 5. JIT Index Hints
- Locate service methods: `rg -n "class VisualTraceService" src/visualTrace` (fallback: `grep -rn "class VisualTraceService" src/visualTrace`)
- Track initialization: `rg -n "initializeVisualTrace" src/device/index.ts` (fallback: `grep -rn "initializeVisualTrace" src/device/index.ts`)
- Inspect test cases: `rg -n "visual-trace" src/tests` (fallback: `grep -rn "visual-trace" src/tests`)

## 6. Common Gotchas
- Always reset trace state via `clearVisualTraceService` to avoid cross-test leakage
- Visual trace relies on screenshot buffers; ensure providers support screenshots before enabling
- Update tests when adjusting retry behaviors or storage paths

## 7. Pre-PR Checks
```bash
npm test -- src/tests/visual-trace.service.spec.ts
```
