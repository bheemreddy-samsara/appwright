---
"@samsara-dev/appwright": patch
---

Add `appiumHandler` option to `aiExecute` for Appium-first with AI fallback

`aiExecute` now accepts an optional second argument with `appiumHandler`. When provided, Appium runs first. If it throws, the AI prompt executes as fallback. Passes through to the native `gpt-driver-node` SDK support.

```typescript
// Before (still works)
await device.gptDriver.aiExecute("tap the login button");

// New: Appium-first with AI fallback
await device.gptDriver.aiExecute("tap the login button", {
  appiumHandler: async () => {
    await device.getById("login-button").tap();
  },
});
```
