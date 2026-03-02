---
"@samsara-dev/appwright": patch
---

Fix device fixture teardown: sync test result before session close

The non-persistent `device` fixture called `syncTestDetails` after `device.close()`, causing BrowserStack to reject updates to closed sessions with 422. Also mapped raw Playwright status values (`timedOut`, `interrupted`) to BrowserStack-compatible `passed`/`failed` and wrapped the call in error handling to prevent sync failures from masking real test errors.

Added `Device.finalizeTest(testInfo)` public method that reuses existing `mapPlaywrightStatus`, `failureReason`, and `safeSync` helpers, matching the persistent fixture's behavior.
