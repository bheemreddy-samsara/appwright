---
"@samsara-dev/appwright": patch
---

Fix stale testId in GPT Driver when using persistent device fixtures

Update testId on the cached gpt-driver-node instance before every API call
so persistent device fixtures (scope: "worker") report the correct test in
GPT Driver sessions. Previously the testId was baked in on first use and
never updated, causing all subsequent tests and resetToHome teardowns to
report the same stale testId on the MobileBoost dashboard.
