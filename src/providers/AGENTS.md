# Providers Guide

## 1. Package Identity
- Manages BrowserStack, LambdaTest, emulator, and local providers plus provider factory wiring
- Responsible for session creation, build uploads, and provider-specific sync hooks

## 2. Setup & Run
```bash
npm run build
npm test -- src/tests/browserstack.s3.spec.ts
npm test -- src/tests/device.spec.ts
```

## 3. Patterns & Conventions
- ✅ DO register providers in `src/providers/index.ts` (`getProviderClass` & `createDeviceProvider`)
- ✅ DO validate required config/env vars early (see `globalSetup` in `src/providers/browserstack/index.ts`)
- ✅ DO reuse `downloadS3Artifact` for remote builds (see `src/providers/browserstack/s3.ts`)
- ✅ DO share your plan before editing provider logic—maintainers expect “thoughts before edits”
- ✅ DO stream subprocess output through `logger` or inherit existing piping in `src/providers/appium.ts`
- ❌ DON’T create `Device` instances manually; always return them via `getDevice()` implementations
- ❌ DON’T persist temp files from uploads; invoke the cleanup handle returned by `downloadS3Artifact`

### Provider Notes
- **BrowserStack:**
  - ✅ Upload local/HTTP/S3 builds via `globalSetup`; see new S3 helper in `src/providers/browserstack/s3.ts`
  - ✅ Keep session sync details current (`syncTestDetails`); tested in `src/tests/device.spec.ts`
  - ✅ Configure `permissionPrompts` on `BrowserStackConfig` to control Android auto-grant and iOS alert handling (iOS 13+ flips accept/dismiss capabilities)
  - ❌ Don’t ignore AWS region—`AWS_REGION` or `AWS_DEFAULT_REGION` must be present for S3 downloads
- **LambdaTest:** mirror BrowserStack capabilities; follow structure in `src/providers/lambdatest/index.ts`
- **Emulator & Local:** rely on Appium bootstrap in `src/providers/appium.ts`; ensure shutdown via `stopAppiumServer`

## 4. Touch Points / Key Files
- `src/providers/index.ts` – provider factory and exports
- `src/providers/browserstack/index.ts` – BrowserStack implementation with S3 + build upload logic
- `src/providers/browserstack/s3.ts` – helper for downloading `s3://` artifacts
- `src/providers/lambdatest/index.ts` – LambdaTest provider implementation
- `src/providers/appium.ts` – shared Appium driver management for local/emulator flows

## 5. JIT Index Hints
- Enumerate providers: `rg -n "class .*Provider" src/providers` (fallback: `grep -rn "class .*Provider" src/providers`)
- Track build uploads: `rg -n "upload" src/providers/browserstack` (fallback: `grep -rn "upload" src/providers/browserstack`)
- Locate S3 helpers: `rg -n "downloadS3Artifact" src/providers/browserstack` (fallback: `grep -rn "downloadS3Artifact" src/providers/browserstack`)
- Inspect Appium wiring: `rg -n "startAppiumServer" src/providers/appium.ts` (fallback: `grep -rn "startAppiumServer" src/providers/appium.ts`)

## 6. Common Gotchas
- BrowserStack uploads require valid credentials plus either local file access, HTTP URL, or S3 URI
- AWS downloads need `AWS_REGION` (or `AWS_DEFAULT_REGION`) and standard SDK env credentials
- Emulator/local providers must stop Appium after use; ensure `stopAppiumServer()` is called on teardown
- Keep provider-specific tests up to date (`src/tests/browserstack.s3.spec.ts`)

## 7. Pre-PR Checks
```bash
npm test -- src/tests/browserstack.s3.spec.ts && npm run build
```
