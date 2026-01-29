import GptDriver from "gpt-driver-node";
// @ts-ignore ts not able to identify the import is just an interface
import type { Client as WebDriverClient } from "webdriver";
import { boxedStep } from "../utils";
import test from "@playwright/test";

const MAX_INSTRUCTION_LENGTH = 10000;

/**
 * GptDriverApi defines the public interface for AI-powered test automation.
 */
export interface GptDriverApi {
  aiExecute(instruction: string): Promise<void>;
  assert(condition: string): Promise<void>;
  assertBulk(conditions: string[]): Promise<void>;
  checkBulk(conditions: string[]): Promise<Record<string, boolean>>;
  extract(extractions: string[]): Promise<Record<string, any>>;
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

  constructor(private webDriverClient: WebDriverClient) {}

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
      cachingMode: "FULL_SCREEN",
      testId: test.info()?.testId ?? `test-${Date.now()}`,
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
}
