---
title: "GPT Driver SDK Integration Code Quality Patterns"
category: integration-issues
tags: [typescript, sdk-integration, input-validation, error-handling, dry-principle, gpt-driver]
module: gptDriver
symptom: "Code review identified type safety issues, duplicated code, missing validation"
root_cause: "Initial implementation focused on functionality over code quality patterns"
date: 2026-01-29
---

# GPT Driver SDK Integration Code Quality Patterns

## Problem Summary

After integrating the `gpt-driver-node` SDK into appwright for AI-powered mobile test automation, code review identified 8 code quality issues. This document captures the patterns and solutions implemented.

## Issues Identified

| Priority | Issue | Resolution |
|----------|-------|------------|
| P1 | Unsafe type casting (`as unknown as undefined`) | Changed to `as any` with clear comment |
| P1 | Duplicated skip logic (DRY violation) | Extracted `requireDriver()` helper |
| P2 | Missing input validation | Added `validateInstruction()` helper |
| P2 | Missing error handling / API key leakage | Added try/catch with `sanitizeError()` |
| P2 | Silent configuration failure | Added `console.debug()` logging |
| P3 | Missing pattern documentation | Added JSDoc for class and interface |
| P3 | Missing SDK methods | Added `assertBulk`, `checkBulk`, `extract` |
| P3 | Missing capabilities parameter | INVALID - SDK doesn't support it |

## Solutions Implemented

### 1. Type Casting Fix

**Problem:** `as unknown as undefined` bypasses type safety entirely.

**Solution:** Use `as any` with documentation:

```typescript
this.driver = new GptDriver({
  apiKey,
  // gpt-driver-node expects webdriverio Browser type but webdriver Client is API-compatible at runtime
  driver: this.webDriverClient as any,
  serverConfig: { url: this.getAppiumUrl() },
  cachingMode: "FULL_SCREEN",
  testId: test.info()?.title ?? `test-${Date.now()}`,
});
```

### 2. DRY Refactor with `requireDriver()`

**Problem:** Identical null-check code duplicated in `aiExecute` and `assert`.

**Solution:** Extract helper that handles initialization and graceful test skipping:

```typescript
private requireDriver(): GptDriver {
  const driver = this.getDriver();
  if (!driver) {
    test.skip(
      true,
      "GPT Driver not configured. Set GPT_DRIVER_API_KEY environment variable.",
    );
    throw new Error("GPT Driver not configured");
  }
  return driver;
}
```

### 3. Input Validation

**Problem:** No validation before external API calls.

**Solution:** Validation helpers with reasonable limits:

```typescript
const MAX_INSTRUCTION_LENGTH = 10000;

private validateInstruction(instruction: string, methodName: string): void {
  if (!instruction || typeof instruction !== "string") {
    throw new Error(`${methodName} requires a non-empty instruction string`);
  }
  if (instruction.length > MAX_INSTRUCTION_LENGTH) {
    throw new Error(
      `${methodName} instruction exceeds maximum length of ${MAX_INSTRUCTION_LENGTH}`,
    );
  }
}

private validateConditions(conditions: string[], methodName: string): void {
  if (!Array.isArray(conditions) || conditions.length === 0) {
    throw new Error(`${methodName} requires a non-empty array of conditions`);
  }
  for (const condition of conditions) {
    this.validateInstruction(condition, methodName);
  }
}
```

### 4. Error Handling with Sanitization

**Problem:** SDK errors might expose API keys.

**Solution:** Wrap SDK calls and sanitize errors:

```typescript
private sanitizeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/[a-zA-Z0-9]{32,}/g, "[REDACTED]");
}

@boxedStep
async aiExecute(instruction: string): Promise<void> {
  this.validateInstruction(instruction, "aiExecute");
  const driver = this.requireDriver();
  try {
    await driver.aiExecute(instruction);
  } catch (error) {
    throw new Error(
      `GPT Driver aiExecute failed: ${this.sanitizeError(error)}`,
    );
  }
}
```

### 5. Debug Logging

**Problem:** Hard to diagnose configuration issues.

**Solution:** Add `console.debug()` in `getDriver()`:

```typescript
if (!apiKey) {
  console.debug(
    "[GptDriver] GPT_DRIVER_API_KEY not set, GPT Driver features disabled",
  );
  return null;
}
// ... initialization ...
console.debug("[GptDriver] Initialized successfully");
```

### 6. Interface Definition

**Solution:** Define public API contract:

```typescript
export interface GptDriverApi {
  aiExecute(instruction: string): Promise<void>;
  assert(condition: string): Promise<void>;
  assertBulk(conditions: string[]): Promise<void>;
  checkBulk(conditions: string[]): Promise<Record<string, boolean>>;
  extract(extractions: string[]): Promise<Record<string, any>>;
}
```

## Important Discovery

**SDK types differ from documentation:**
- `checkBulk` returns `Record<string, boolean>` (not array of objects)
- `extract` takes `string[]` and returns `Record<string, any>` (not single string)

Always verify actual SDK type definitions:
```bash
cat node_modules/gpt-driver-node/dist/index.d.ts
```

## Prevention Checklist

### Before SDK Integration
- [ ] Read actual `.d.ts` type definitions, not just docs
- [ ] Pin SDK version appropriately
- [ ] Plan for graceful degradation when not configured

### For Each Method
- [ ] Validate inputs before external calls
- [ ] Wrap SDK calls in try/catch
- [ ] Sanitize error messages
- [ ] Add contextual information to errors
- [ ] Use `@boxedStep` decorator for tracing

### Code Quality
- [ ] Extract duplicated logic after 2+ occurrences
- [ ] Use `as any` (not `as unknown as X`) with clear comments
- [ ] Add `console.debug()` for configuration visibility
- [ ] Document patterns with JSDoc

## Files Modified

- `src/gptDriver/index.ts` - Complete provider implementation
- `src/device/index.ts` - Exposed methods through Device class

## Usage Examples

```typescript
// Execute AI-powered action
await device.gptDriver.aiExecute("tap on the login button");

// Assert a single condition
await device.gptDriver.assert("welcome message is visible");

// Assert multiple conditions
await device.gptDriver.assertBulk(["button is visible", "text shows 'Hello'"]);

// Check conditions without failing
const results = await device.gptDriver.checkBulk(["logged in", "menu open"]);
// results: { "logged in": true, "menu open": false }

// Extract data from screen
const data = await device.gptDriver.extract(["total price", "item count"]);
// data: { "total price": "$42.99", "item count": "3" }
```

## Related

- Error types: `src/types/errors.ts`
- SDK docs: https://docs.mobileboost.io/gpt-driver-sdk/appium/typescript/reference
