---
"@samsara-dev/appwright": patch
---

feat(gptDriver): integrate GPT Driver SDK for AI-powered test automation

Add GPT Driver SDK integration enabling natural language test automation via `device.gptDriver.*` methods:

- `aiExecute(instruction)` - execute AI-powered actions
- `assert(condition)` - verify screen state with natural language
- `assertBulk(conditions)` - verify multiple conditions at once
- `checkBulk(conditions)` - check conditions without failing test
- `extract(extractions)` - extract data from screen

Requires `GPT_DRIVER_API_KEY` environment variable. Tests gracefully skip when not configured.
