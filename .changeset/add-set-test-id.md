---
"@samsara-dev/appwright": minor
---

Add `gptDriver.setTestId()` for explicit session attribution

Worker-scoped fixtures (e.g. login) previously inherited the testId from
whichever Playwright test triggered the worker first, causing MobileBoost
sessions to be mis-attributed. `setTestId(id)` lets callers tag these
shared sessions with a descriptive ID (e.g. "worker-login-setup").

The override takes priority over `testIdFormat` and `test.info().testId`,
and is cleared automatically on `reset()`.
