---
"@samsara-dev/appwright": patch
---

Fix persistent device video download race condition that caused the process to hang when a worker had only one test (common with retries). When the 5-second delay wasn't enough for endTime to be written, the code misclassified the last test as intermediate and waited for a file that only the endTime download path would create. The intermediate test branch now polls for both the video file on disk and endTime being set, and all downloads go through a per-session lock to prevent concurrent writes.
