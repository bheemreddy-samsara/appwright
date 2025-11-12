# AGENTS OVERVIEW

This document summarizes the Appwright test automation project so autonomous agents understand the environment, capabilities, and workflows before making changes.

## Project Snapshot

- **Package name:** `@samsara-dev/appwright`
- **Language:** TypeScript targeting Node.js ≥ 20.19
- **Distribution entry:** `dist/index.js` (compiled via `npm run build`)
- **Primary domains:** Mobile app end-to-end automation on real devices or device farms (BrowserStack, LambdaTest, local emulators)

## Repository Layout

- `src/` – TypeScript sources (single source of truth)
- `dist/` – Generated JavaScript and type declarations; never edit manually
- `example/` – Sample usage and fixtures
- `docs/` – Generated documentation assets
- `.changeset/` – Release notes authored via Changesets
- `node_modules/` – Managed dependencies (do not commit edits)

## Core Concepts & Types

- `Device` class wraps a WebDriver client for mobile-specific flows and is exported from `src/index.ts`.
- `Locator` utilities hold find strategies and timeout behavior derived from `TimeoutOptions`.
- Providers (`src/providers/*`) bootstrap sessions for BrowserStack, LambdaTest, local, and emulator contexts.
- Vision utilities in `src/vision` offer computer-vision-assisted interactions.

## Key Commands

```bash
npm run build   # Compile TypeScript to dist/
npm test        # Run Vitest test suite once

npm run lint    # Lint via ESLint configuration
npm run changeset # Create or update release notes
```

## Device Helper Summary

- `device.getTimeouts()` – Returns the underlying WebDriver timeout configuration (implicit, pageLoad, script, command if available).
- `device.getWindowRect()` – Exposes the active window rectangle `{ width, height, x, y }` for layout-aware actions.
- `device.isKeyboardShown()` – Checks virtual keyboard visibility; supported on iOS sessions where the provider exposes the API.

## Development Guardrails

- Always apply edits in `src/` and rebuild; never patch `dist/` directly.
- Ensure additions remain backward compatible; prefer optional or additive APIs.
- Run build + tests before concluding any workflow to catch regressions.
- Use Changesets for versioned changes and keep release notes concise.

## Provider Notes

- BrowserStack-specific capabilities live under `src/providers/browserstack` and may take advantage of executor scripts (e.g., camera image injection, keyboard state).
- LambdaTest support mirrors BrowserStack patterns but with differing executor APIs.
- Local and emulator providers rely on Appium capabilities configured through project fixtures.

## Telemetry & Vision

- Visual trace services are coordinated via `src/visualTrace` to capture screenshots across retries.
- Vision-based interactions are powered by `@empiricalrun/llm` models; see `Device.beta` helpers for experimental flows.

## Release Workflow

1. Author a Changeset describing user-facing impact.
2. Run `npm run build` and `npm test` to validate artifacts.
3. Submit PR targeting `main`; CI validates lint/tests.
4. Publish via `changeset publish` when ready for release.

Agents should adhere to these guardrails to ensure repeatable, secure automation within the Appwright codebase.