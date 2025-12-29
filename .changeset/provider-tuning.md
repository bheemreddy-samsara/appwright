---
"@samsara-dev/appwright": patch
---

Add configurable Appium settings for emulator/local devices via `AppiumSettings`
(`waitForIdleTimeout`, `newCommandTimeout`, `snapshotMaxDepth`,
`waitForSelectorTimeout`, `actionAcknowledgmentTimeout`, `ignoreUnimportantViews`,
`customSnapshotTimeout`, `waitForQuiescence`, `animationCoolOffTimeout`,
`reduceMotion`, `snapshotTimeout`, `includeSafariInWebviews`,
`chromedriverAutodownload`) to tune Android/iOS behavior for apps that never
become idle.

BrowserStack adds geolocation, Appium updateSettings tuning, and a video
download opt-out that also skips waits when downloads are disabled.
