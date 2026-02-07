---
"@samsara-dev/appwright": patch
---

Fix reporter error when persistent device worker has no session

Previously, the VideoDownloader reporter threw an error when a worker's info
file existed but had no `providerName` or `sessionId` (e.g., when a test was
skipped before establishing a BrowserStack session). This caused misleading
"Failed to get worker end time" error logs.

Now gracefully skips video download for workers without sessions instead of
throwing.
