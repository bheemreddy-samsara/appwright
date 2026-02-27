---
"@samsara-dev/appwright": minor
---

Surface `setSessionSucceeded`, `setSessionFailed`, and `useSmartLoop` from gpt-driver-node SDK.

- `setSessionSucceeded()` / `setSessionFailed()`: Mark MobileBoost session status for dashboard filtering and cache validation.
- `useSmartLoop` on `aiExecute`: Enable Cache → AI → Execute → Populate cycle for faster repeat runs.
