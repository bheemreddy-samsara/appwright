import GptDriver from "gpt-driver-node";
// @ts-ignore ts not able to identify the import is just an interface
import type { Client as WebDriverClient } from "webdriver";
import { boxedStep } from "../utils";
import test from "@playwright/test";
import type { GptDriverConfig, TestIdInfo } from "../types";
import { logger } from "../logger";

const MAX_INSTRUCTION_LENGTH = 10000;

/**
 * Options for aiExecute.
 * cachingMode is set globally at provider init (INTERACTION_REGION).
 */
export interface AiExecuteOptions {
  appiumHandler?: () => Promise<void>;
  /**
   * Enable Smart Loop: Cache → AI → Execute → Populate cycle.
   * On cache hit, replays stored Appium commands without an AI call (~1-2s vs ~15s).
   * On cache miss, falls back to AI, then populates cache for future runs.
   * Cache key: hash(apiKey + testId + stepNumber + description + platform + resolution).
   */
  useSmartLoop?: boolean;
}

/**
 * GptDriverApi defines the public interface for AI-powered test automation.
 */
export interface GptDriverApi {
  aiExecute(instruction: string, options?: AiExecuteOptions): Promise<void>;
  assert(condition: string): Promise<void>;
  assertBulk(conditions: string[]): Promise<void>;
  checkBulk(conditions: string[]): Promise<Record<string, boolean>>;
  extract(extractions: string[]): Promise<Record<string, any>>;
  /** Mark the MobileBoost session as succeeded. Call after test passes. */
  setSessionSucceeded(): Promise<void>;
  /** Mark the MobileBoost session as failed. Call after test fails. */
  setSessionFailed(): Promise<void>;
}

/**
 * GptDriverProvider wraps the gpt-driver-node SDK for AI-powered test automation.
 *
 * Pattern: Lazy-initialized singleton per Device instance.
 * - Driver is created on first use (not in constructor)
 * - Cached for subsequent calls
 * - Gracefully skips tests when API key is not configured
 *
 * Similar to: VisionProvider
 */
export class GptDriverProvider implements GptDriverApi {
  private driver: GptDriver | null = null;
  private testIdWarned = false;

  constructor(
    private webDriverClient: WebDriverClient,
    private options?: GptDriverConfig,
  ) {}

  /**
   * Resolve the testId for the current test context.
   * Uses the custom testIdFormat callback if configured, otherwise falls back
   * to Playwright's hash-based testId.
   */
  private resolveTestId(
    testInfo:
      | { testId: string; title: string; titlePath: string[] }
      | undefined,
  ): string | undefined {
    if (!testInfo) return undefined;
    if (this.options?.testIdFormat) {
      const info: TestIdInfo = {
        title: testInfo.title,
        titlePath: testInfo.titlePath,
      };
      return this.options.testIdFormat(info);
    }
    return testInfo.testId;
  }

  private getAppiumUrl(): string {
    const { protocol, hostname, port, path, user, key } =
      this.webDriverClient.options;
    // Include basic auth for cloud providers (BrowserStack, LambdaTest)
    const auth = user && key ? `${user}:${key}@` : "";
    return `${protocol}://${auth}${hostname}:${port}${path}`;
  }

  private getDriver(): GptDriver | null {
    if (this.driver) return this.driver;

    const apiKey = process.env.GPT_DRIVER_API_KEY;
    if (!apiKey) {
      console.debug(
        "[GptDriver] GPT_DRIVER_API_KEY not set, GPT Driver features disabled",
      );
      return null;
    }

    this.driver = new GptDriver({
      apiKey,
      // gpt-driver-node expects webdriverio Browser type but webdriver Client is API-compatible at runtime
      driver: this.webDriverClient as any,
      serverConfig: { url: this.getAppiumUrl() },
      cachingMode: "INTERACTION_REGION",
      testId: this.resolveTestId(test.info()) ?? `test-${Date.now()}`,
      ...(this.options?.additionalUserContext != null && {
        additionalUserContext: this.options.additionalUserContext,
      }),
    });
    console.debug("[GptDriver] Initialized successfully");
    return this.driver;
  }

  private requireDriver(): GptDriver {
    const driver = this.getDriver();
    if (!driver) {
      test.skip(
        true,
        "GPT Driver not configured. Set GPT_DRIVER_API_KEY environment variable.",
      );
      throw new Error("GPT Driver not configured");
    }

    // Update testId to current test context so persistent device fixtures
    // report the correct test in GPT Driver API calls.
    // gpt-driver-node declares testId as private in TS but it's a plain
    // JS property at runtime — safe to mutate directly.
    // TODO: Replace with public setTestId() if gpt-driver-node exposes one.
    const currentTestId = this.resolveTestId(test.info());
    if (currentTestId && "testId" in (driver as any)) {
      (driver as any).testId = currentTestId;
    } else if (currentTestId && !this.testIdWarned) {
      console.warn(
        "[GptDriver] Cannot update testId — property not found on driver instance. " +
          "GPT Driver sessions may be attributed to the wrong test. " +
          "Check if gpt-driver-node renamed or removed the testId field.",
      );
      this.testIdWarned = true;
    }

    return driver;
  }

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

  private sanitizeError(error: unknown): string {
    const message = error instanceof Error ? error.message : String(error);
    return message.replace(/[a-zA-Z0-9]{32,}/g, "[REDACTED]");
  }

  @boxedStep
  async aiExecute(
    instruction: string,
    options?: AiExecuteOptions,
  ): Promise<void> {
    this.validateInstruction(instruction, "aiExecute");
    const driver = this.requireDriver();
    try {
      await driver.aiExecute(instruction, {
        ...(options?.appiumHandler && { appiumHandler: options.appiumHandler }),
        ...(options?.useSmartLoop && { useSmartLoop: true }),
      });
    } catch (error) {
      throw new Error(
        `GPT Driver aiExecute failed: ${this.sanitizeError(error)}`,
      );
    }
  }

  @boxedStep
  async assert(condition: string): Promise<void> {
    this.validateInstruction(condition, "assert");
    const driver = this.requireDriver();
    try {
      await driver.assert(condition, {});
    } catch (error) {
      throw new Error(
        `GPT Driver assertion failed: ${this.sanitizeError(error)}`,
      );
    }
  }

  @boxedStep
  async assertBulk(conditions: string[]): Promise<void> {
    this.validateConditions(conditions, "assertBulk");
    const driver = this.requireDriver();
    try {
      await driver.assertBulk(conditions, {});
    } catch (error) {
      throw new Error(
        `GPT Driver assertBulk failed: ${this.sanitizeError(error)}`,
      );
    }
  }

  @boxedStep
  async checkBulk(conditions: string[]): Promise<Record<string, boolean>> {
    this.validateConditions(conditions, "checkBulk");
    const driver = this.requireDriver();
    try {
      return await driver.checkBulk(conditions);
    } catch (error) {
      throw new Error(
        `GPT Driver checkBulk failed: ${this.sanitizeError(error)}`,
      );
    }
  }

  @boxedStep
  async extract(extractions: string[]): Promise<Record<string, any>> {
    this.validateConditions(extractions, "extract");
    const driver = this.requireDriver();
    try {
      return await driver.extract(extractions);
    } catch (error) {
      throw new Error(
        `GPT Driver extract failed: ${this.sanitizeError(error)}`,
      );
    }
  }

  async setSessionSucceeded(): Promise<void> {
    const driver = this.getDriver();
    if (!driver) return;
    try {
      await driver.setSessionSucceeded();
    } catch (error) {
      logger.warn(
        `[GptDriver] Failed to mark session as succeeded: ${this.sanitizeError(error)}`,
      );
    }
  }

  async setSessionFailed(): Promise<void> {
    const driver = this.getDriver();
    if (!driver) return;
    try {
      await driver.setSessionFailed();
    } catch (error) {
      logger.warn(
        `[GptDriver] Failed to mark session as failed: ${this.sanitizeError(error)}`,
      );
    }
  }
}
