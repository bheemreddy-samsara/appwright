---
"@samsara-dev/appwright": patch
---

Add `testIdFormat` option to `GptDriverConfig` for human-readable GPT Driver session IDs. When configured, replaces Playwright's hash-based testId with a custom format (e.g. "Form Submission - submit form with all field types") in every MobileBoost API call. Backward-compatible: omitting the option preserves existing behavior.
