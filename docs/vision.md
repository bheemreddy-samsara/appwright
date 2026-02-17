# AI-Powered Test Methods

Appwright provides AI-powered methods for interacting with and extracting information from the screen via [GPT Driver](https://gptdriver.com). All methods require the `GPT_DRIVER_API_KEY` environment variable.

## Execute actions on the screen

The `aiExecute` method performs AI-driven actions on the screen based on a natural language prompt.

```ts
await device.gptDriver.aiExecute("tap on the login button");
```

You can provide an Appium-first handler with AI as a fallback:

```ts
await device.gptDriver.aiExecute("tap on the login button", {
  appiumHandler: async () => {
    await device.getById("login-button").tap();
  },
});
```

## Extract information from the screen

The `query` method extracts a single value from the screen based on a prompt.

```ts
const text = await device.gptDriver.query("Extract the contact details present in the footer");
```

You can specify a Zod schema to get a typed response:

```ts
const isLoginButtonVisible = await device.gptDriver.query(
  "Is the login button visible on the screen?",
  {
    responseFormat: z.boolean(),
  },
);
```

For extracting multiple values at once, use `extract`:

```ts
const data = await device.gptDriver.extract(["total price", "item count"]);
// data = { "total price": "$19.99", "item count": "3" }
```

## Assert screen state

```ts
await device.gptDriver.assert("welcome message is visible");
await device.gptDriver.assertBulk(["button is visible", "text shows 'Hello'"]);
const results = await device.gptDriver.checkBulk(["logged in", "menu open"]);
```

## Migration from `device.beta`

| Before | After |
|--------|-------|
| `device.beta.tap("tap login")` | `device.gptDriver.aiExecute("tap login")` |
| `device.beta.query("get price")` | `device.gptDriver.query("get price")` |
| `device.beta.query(p, { responseFormat: z.object({...}) })` | `device.gptDriver.query(p, { responseFormat: z.object({...}) })` |
| `OPENAI_API_KEY` + `EMPIRICAL_API_KEY` | `GPT_DRIVER_API_KEY` |

**Behavioral change:** `device.beta.tap()` returned `Promise<{ x: number; y: number }>` (tap coordinates). `device.gptDriver.aiExecute()` returns `Promise<void>` — coordinate data is not available from the GPT Driver SDK.

The following `device.beta` options have no GPT Driver equivalent and have been dropped:

- `model` — GPT Driver uses its own model server-side
- `useCache` — GPT Driver has its own caching via `cachingMode: "FULL_SCREEN"`
- `screenshot` — GPT Driver takes its own screenshots via the Appium session
- `telemetry.tags` — GPT Driver uses `testId` instead
