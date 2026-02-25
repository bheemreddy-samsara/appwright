---
"@samsara-dev/appwright": patch
---

Validate MP4 moov atom after BrowserStack video download to prevent corrupt video attachments. BrowserStack can return HTTP 200 with a video still being finalized (missing moov atom). The download retry loop now re-downloads until the file has a valid moov atom, capped at 5 retries.
