---
"@samsara-dev/appwright": minor
---

Remove `@empiricalrun/llm` dependency and `device.beta` API. Use `device.gptDriver.aiExecute()` instead of `device.beta.tap()` and `device.gptDriver.query()` instead of `device.beta.query()`. Only `GPT_DRIVER_API_KEY` is required (no more `OPENAI_API_KEY` or `EMPIRICAL_API_KEY`).
