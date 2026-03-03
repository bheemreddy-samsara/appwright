---
"@samsara-dev/appwright": minor
---

Add `noReset` option to all device configs and `APPWRIGHT_NO_RESET` environment variable. When enabled, the app is not uninstalled/reinstalled between sessions — Appium installs the app only if not already present. Useful for local development iteration with an already-configured app.
