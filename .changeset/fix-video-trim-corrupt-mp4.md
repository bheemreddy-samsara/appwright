---
"@samsara-dev/appwright": patch
---

Fix corrupt video trim when BrowserStack video download is incomplete

- Recreate write stream on each download retry to avoid appending corrupt data from previous failed attempts
- Add MP4 moov atom validation before attempting ffmpeg trim to fail fast with a clear error
