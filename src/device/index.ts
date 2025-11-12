// @ts-ignore ts not able to identify the import is just an interface
import type { Client as WebDriverClient } from "webdriver";
import { Locator } from "../locator";
import {
  AppwrightLocator,
  DeviceProvider,
  ExtractType,
  IosAppSettings,
  IosPermissionSettings,
  Platform,
  TimeoutOptions,
  VisualTraceConfig,
} from "../types";
import { AppwrightVision, VisionProvider } from "../vision";
import { boxedStep, longestDeterministicGroup } from "../utils";
import { uploadImageToBS } from "../providers/browserstack/utils";
import { uploadImageToLambdaTest } from "../providers/lambdatest/utils";
import { z } from "zod";
import { LLMModel } from "@empiricalrun/llm";
import { logger } from "../logger";
import {
  VisualTraceService,
  initializeVisualTrace,
  clearVisualTraceService,
} from "../visualTrace";
import { TestInfo } from "@playwright/test";

type DeviceTimeouts = Partial<Record<string, number>> & { command?: number };

export class Device {
  private visualTraceService?: VisualTraceService;
  private deviceProvider?: DeviceProvider;
  private persistentSyncEnabled = false;
  private activePersistentKey?: string;

  constructor(
    private webDriverClient: WebDriverClient,
    private bundleId: string | undefined,
    private timeoutOpts: TimeoutOptions,
    private provider: string,
    deviceProvider?: DeviceProvider,
  ) {
    this.deviceProvider = deviceProvider;
  }

  attachDeviceProvider(provider: DeviceProvider): void {
    this.deviceProvider = provider;
  }

  enablePersistentStatusSync(): void {
    this.persistentSyncEnabled = true;
  }

  async ensurePersistentLifecycle(testInfo: TestInfo): Promise<void> {
    if (!this.shouldSyncPersistent()) {
      return;
    }
    await this.preparePersistentTest(testInfo);
  }

  async preparePersistentTest(testInfo: TestInfo): Promise<void> {
    if (!this.shouldSyncPersistent()) {
      return;
    }
    const key = this.persistentKey(testInfo);
    if (this.activePersistentKey === key) {
      return;
    }
    this.activePersistentKey = key;
    await this.safeSync({ name: testInfo.title });
  }

  async finalizePersistentTest(testInfo: TestInfo): Promise<void> {
    if (!this.shouldSyncPersistent()) {
      return;
    }
    const key = this.persistentKey(testInfo);
    if (!this.activePersistentKey) {
      logger.warn(
        "finalizePersistentTest called before preparePersistentTest; syncing anyway.",
      );
    } else if (this.activePersistentKey !== key) {
      logger.warn(
        "finalizePersistentTest received unexpected test key; syncing anyway.",
      );
    }
    const status = this.mapPlaywrightStatus(testInfo.status);
    const reason =
      status === "failed" ? this.failureReason(testInfo) : undefined;
    await this.safeSync({
      name: testInfo.title,
      status,
      reason,
    });
    this.activePersistentKey = undefined;
  }

  private shouldSyncPersistent(): boolean {
    return (
      this.persistentSyncEnabled === true &&
      typeof this.deviceProvider?.syncTestDetails === "function"
    );
  }

  private persistentKey(testInfo: TestInfo): string {
    return `${testInfo.testId}#${testInfo.retry}`;
  }

  private mapPlaywrightStatus(status: TestInfo["status"]): string {
    switch (status) {
      case "failed":
      case "timedOut":
      case "interrupted":
        return "failed";
      case "passed":
      case "skipped":
      default:
        return "passed";
    }
  }

  private failureReason(testInfo: TestInfo): string | undefined {
    const error = testInfo.errors?.[0];
    if (error?.message) {
      return error.message;
    }
    return testInfo.error?.message;
  }

  private async safeSync(details: {
    status?: string;
    reason?: string;
    name?: string;
  }): Promise<void> {
    if (!this.deviceProvider?.syncTestDetails) {
      return;
    }
    try {
      await this.deviceProvider.syncTestDetails(details);
    } catch (error) {
      logger.warn("Failed to sync test details", error);
    }
  }

  /**
   * Initialize Visual Trace Service for screenshot capture during test execution
   */
  initializeVisualTrace(
    testInfo: TestInfo,
    retryIndex: number,
    config?: VisualTraceConfig,
  ): void {
    this.visualTraceService = initializeVisualTrace(
      testInfo,
      retryIndex,
      config,
    );
  }

  /**
   * Take a screenshot - exposed for Visual Trace Service
   */
  async takeScreenshot(): Promise<Buffer> {
    const base64Screenshot = await this.webDriverClient.takeScreenshot();
    return Buffer.from(base64Screenshot, "base64");
  }

  locator({
    selector,
    findStrategy,
    textToMatch,
  }: {
    selector: string;
    findStrategy: string;
    textToMatch?: string | RegExp;
  }): AppwrightLocator {
    return new Locator(
      this.webDriverClient,
      this.timeoutOpts,
      selector,
      findStrategy,
      textToMatch,
      this, // Pass device reference for Visual Trace Service
    );
  }

  private vision(): AppwrightVision {
    return new VisionProvider(this, this.webDriverClient);
  }

  beta = {
    tap: async (
      prompt: string,
      options?: {
        useCache?: boolean;
        telemetry?: {
          tags?: string[];
        };
      },
    ): Promise<{ x: number; y: number }> => {
      return await this.vision().tap(prompt, options);
    },

    query: async <T extends z.ZodType>(
      prompt: string,
      options?: {
        responseFormat?: T;
        model?: LLMModel;
        screenshot?: string;
        telemetry?: {
          tags?: string[];
        };
      },
    ): Promise<ExtractType<T>> => {
      return await this.vision().query(prompt, options);
    },
  };

  /**
   * Closes the automation session. This is called automatically after each test.
   *
   * **Usage:**
   * ```js
   * await device.close();
   * ```
   */
  async close() {
    // TODO: Add @boxedStep decorator here
    // Disabled because it breaks persistentDevice as test.step will throw as test is
    // undefined when the function is called
    try {
      await this.webDriverClient.deleteSession();
    } catch (e) {
      logger.error(`close:`, e);
    }

    // Clean up visual trace service
    if (this.visualTraceService) {
      clearVisualTraceService();
      this.visualTraceService = undefined;
    }
  }

  /**
   * Tap on the screen at the given coordinates, specified as x and y. The top left corner
   * of the screen is { x: 0, y: 0 }.
   *
   * **Usage:**
   * ```js
   * await device.tap({ x: 100, y: 100 });
   * ```
   *
   * @param coordinates to tap on
   * @returns
   */
  @boxedStep
  async tap({ x, y }: { x: number; y: number }) {
    if (this.getPlatform() == Platform.ANDROID) {
      await this.webDriverClient.executeScript("mobile: clickGesture", [
        {
          x: x,
          y: y,
          duration: 100,
          tapCount: 1,
        },
      ]);
    } else {
      await this.webDriverClient.executeScript("mobile: tap", [
        {
          x: x,
          y: y,
        },
      ]);
    }
  }

  /**
   * Locate an element on the screen with text content. This method defaults to a
   * substring match, and this be overridden by setting the `exact` option to `true`.
   *
   * **Usage:**
   * ```js
   * // with string
   * const submitButton = device.getByText("Submit");
   *
   * // with RegExp
   * const counter = device.getByText(/^Counter: \d+/);
   * ```
   *
   * @param text string or regular expression to search for
   * @param options
   * @returns
   */
  getByText(
    text: string | RegExp,
    { exact = false }: { exact?: boolean } = {},
  ): AppwrightLocator {
    const isAndroid = this.getPlatform() == Platform.ANDROID;
    if (text instanceof RegExp) {
      const substringForContains = longestDeterministicGroup(text);
      if (!substringForContains) {
        return this.locator({
          selector: "//*",
          findStrategy: "xpath",
          textToMatch: text,
        });
      } else {
        const selector = isAndroid
          ? `textContains("${substringForContains}")`
          : `label CONTAINS "${substringForContains}"`;
        return this.locator({
          selector: selector,
          findStrategy: isAndroid
            ? "-android uiautomator"
            : "-ios predicate string",
          textToMatch: text,
        });
      }
    }
    let path: string;
    if (isAndroid) {
      path = exact ? `text("${text}")` : `textContains("${text}")`;
    } else {
      path = exact ? `label == "${text}"` : `label CONTAINS "${text}"`;
    }
    return this.locator({
      selector: path,
      findStrategy: isAndroid
        ? "-android uiautomator"
        : "-ios predicate string",
      textToMatch: text,
    });
  }

  /**
   * Locate an element on the screen with accessibility identifier. This method defaults to
   * a substring match, and this can be overridden by setting the `exact` option to `true`.
   *
   * **Usage:**
   * ```js
   * const element = await device.getById("signup_button");
   * ```
   *
   * @param text string to search for
   * @param options
   * @returns
   */
  getById(
    text: string,
    { exact = false }: { exact?: boolean } = {},
  ): AppwrightLocator {
    const isAndroid = this.getPlatform() == Platform.ANDROID;
    let path: string;
    if (isAndroid) {
      path = exact ? `resourceId("${text}")` : `resourceIdMatches("${text}")`;
    } else {
      path = exact ? `name == "${text}"` : `name CONTAINS "${text}"`;
    }
    return this.locator({
      selector: path,
      findStrategy: isAndroid
        ? "-android uiautomator"
        : "-ios predicate string",
      textToMatch: text,
    });
  }

  /**
   * Locate an element on the screen with xpath.
   *
   * **Usage:**
   * ```js
   * const element = await device.getByXpath(`//android.widget.Button[@text="Confirm"]`);
   * ```
   *
   * @param xpath xpath to locate the element
   * @returns
   */
  getByXpath(xpath: string): AppwrightLocator {
    return this.locator({ selector: xpath, findStrategy: "xpath" });
  }

  /**
   * Helper method to detect the mobile OS running on the device.
   *
   * **Usage:**
   * ```js
   * const platform = device.getPlatform();
   * ```
   *
   * @returns "android" or "ios"
   */
  getPlatform(): Platform {
    const isAndroid = this.webDriverClient.isAndroid;
    return isAndroid ? Platform.ANDROID : Platform.IOS;
  }

  @boxedStep
  async terminateApp(bundleId?: string) {
    if (!this.bundleId && !bundleId) {
      throw new Error("bundleId is required to terminate the app.");
    }
    const keyName =
      this.getPlatform() == Platform.ANDROID ? "appId" : "bundleId";
    await this.webDriverClient.executeScript("mobile: terminateApp", [
      {
        [keyName]: bundleId || this.bundleId,
      },
    ]);
  }

  @boxedStep
  async activateApp(bundleId?: string) {
    if (!this.bundleId && !bundleId) {
      throw new Error("bundleId is required to activate the app.");
    }
    const keyName =
      this.getPlatform() == Platform.ANDROID ? "appId" : "bundleId";
    await this.webDriverClient.executeScript("mobile: activateApp", [
      {
        [keyName]: bundleId || this.bundleId,
      },
    ]);
  }

  /**
   * Sends the currently running app to the background.
   *
   * @param seconds - Number of seconds to keep app in background.
   *                  Use -1 to background indefinitely (until manually reactivated).
   *                  If positive number, app returns to foreground after specified seconds.
   *
   * @example
   * ```js
   * // Background for 10 seconds then auto-return
   * await device.backgroundApp(10);
   *
   * // Background indefinitely (for battery tests)
   * await device.backgroundApp(-1);
   * await device.pause(30 * 60 * 1000); // Wait 30 minutes
   * await device.activateApp(); // Manually bring back
   * ```
   */
  @boxedStep
  async backgroundApp(seconds: number = -1): Promise<void> {
    await this.webDriverClient.executeScript("mobile: backgroundApp", [
      {
        seconds,
      },
    ]);
  }

  /**
   * Retrieves text content from the clipboard of the mobile device. This is useful
   * after a "copy to clipboard" action has been performed. This returns base64 encoded string.
   *
   * **Usage:**
   * ```js
   * const clipboardText = await device.getClipboardText();
   * ```
   *
   * @returns Returns the text content of the clipboard in base64 encoded string.
   */
  @boxedStep
  async getClipboardText(): Promise<string> {
    if (this.getPlatform() == Platform.ANDROID) {
      return await this.webDriverClient.getClipboard();
    } else {
      if (this.provider == "emulator") {
        // iOS simulator supports clipboard sharing
        return await this.webDriverClient.getClipboard();
      } else {
        if (!this.bundleId) {
          throw new Error(
            "bundleId is required to retrieve clipboard data on a real device.",
          );
        }
        await this.activateApp("com.facebook.WebDriverAgentRunner.xctrunner");
        const clipboardDataBase64 = await this.webDriverClient.getClipboard();
        await this.activateApp(this.bundleId);
        return clipboardDataBase64;
      }
    }
  }

  /**
   * Sets a mock camera view using the specified image. This injects a mock image into the camera view.
   * Currently, this functionality is supported only for BrowserStack.
   *
   * **Usage:**
   * ```js
   * await device.setMockCameraView(`screenshot.png`);
   * ```
   *
   * @param imagePath path to the image file that will be used as the mock camera view.
   * @returns
   */
  @boxedStep
  async setMockCameraView(imagePath: string): Promise<void> {
    if (this.provider == "browserstack") {
      const imageURL = await uploadImageToBS(imagePath);
      await this.webDriverClient.executeScript(
        `browserstack_executor: {"action":"cameraImageInjection", "arguments": {"imageUrl" : "${imageURL}"}}`,
        [],
      );
    } else if (this.provider == "lambdatest") {
      const imageURL = await uploadImageToLambdaTest(imagePath);
      await this.webDriverClient.executeScript(
        `lambda-image-injection=${imageURL}`,
        [],
      );
    }
  }

  @boxedStep
  async pause() {
    const skipPause = process.env.CI === "true";
    if (skipPause) {
      return;
    }
    logger.log(`device.pause: Use Appium Inspector to attach to the session.`);
    let iterations = 0;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      await new Promise((resolve) => setTimeout(resolve, 20_000));
      await this.webDriverClient.takeScreenshot();
      iterations += 1;
      if (iterations % 3 === 0) {
        logger.log(`device.pause: ${iterations * 20} secs elapsed.`);
      }
    }
  }

  @boxedStep
  async waitForTimeout(timeout: number) {
    await new Promise((resolve) => setTimeout(resolve, timeout));
  }

  /**
   * Get the current timeout settings for the WebDriver session.
   */
  @boxedStep
  async getTimeouts(): Promise<DeviceTimeouts> {
    return (await this.webDriverClient.getTimeouts()) as DeviceTimeouts;
  }

  /**
   * Get the current window rectangle dimensions.
   */
  @boxedStep
  async getWindowRect(): Promise<{
    width: number;
    height: number;
    x: number;
    y: number;
  }> {
    return await this.webDriverClient.getWindowRect();
  }

  /**
   * Get a screenshot of the current screen as a base64 encoded string.
   */
  @boxedStep
  async screenshot(): Promise<string> {
    return await this.webDriverClient.takeScreenshot();
  }

  /**
   * [iOS Only]
   * Scroll the screen from 0.2 to 0.8 of the screen height.
   * This can be used for controlled scroll, for auto scroll checkout `scroll` method from locator.
   *
   * **Usage:**
   * ```js
   * await device.scroll();
   * ```
   *
   */
  @boxedStep
  async scroll(): Promise<void> {
    const driverSize = await this.webDriverClient.getWindowRect();
    // Scrolls from 0.8 to 0.2 of the screen height
    const from = { x: driverSize.width / 2, y: driverSize.height * 0.8 };
    const to = { x: driverSize.width / 2, y: driverSize.height * 0.2 };
    await this.webDriverClient.executeScript("mobile: dragFromToForDuration", [
      { duration: 2, fromX: from.x, fromY: from.y, toX: to.x, toY: to.y },
    ]);
  }

  /**
   * Send keys to already focused input field.
   * To fill input fields using the selectors use `sendKeyStrokes` method from locator
   */
  @boxedStep
  async sendKeyStrokes(value: string): Promise<void> {
    const actions = value
      .split("")
      .map((char) => [
        { type: "keyDown", value: char },
        { type: "keyUp", value: char },
      ])
      .flat();

    await this.webDriverClient.performActions([
      {
        type: "key",
        id: "keyboard",
        actions: actions,
      },
    ]);

    await this.webDriverClient.releaseActions();
  }

  /**
   * Updates iOS app settings via BrowserStack executor (mid-session).
   * For default settings, prefer configuring them in appwright.config.ts.
   *
   * @param args - Permission settings or Settings bundle entries
   * @example
   * // Update permissions mid-session
   * await device.updateAppSettings({
   *   'Permission Settings': { Camera: 'Allow' }
   * });
   *
   * @example
   * // Update custom settings
   * await device.updateAppSettings({
   *   'DarkMode': 1,
   *   'Environment': 'production'
   * });
   */
  @boxedStep
  public async updateAppSettings(args: IosAppSettings): Promise<void> {
    this.assertIOSBrowserStack("updateAppSettings");

    const executor = {
      action: "updateAppSettings",
      arguments: args,
    };

    const script = `browserstack_executor: ${JSON.stringify(executor)}`;
    await this.webDriverClient.executeScript(script, []);
  }

  /**
   * Convenience method for updating iOS permission settings mid-session.
   * For default permissions, prefer configuring them in appwright.config.ts.
   *
   * @param settings - iOS permission settings to update
   * @example
   * await device.updatePermissionSettings({
   *   Location: {
   *     'ALLOW LOCATION ACCESS': 'Always',
   *     'Precise Location': 'ON'
   *   },
   *   Camera: 'Allow'
   * });
   */
  @boxedStep
  public async updatePermissionSettings(
    settings: IosPermissionSettings,
  ): Promise<void> {
    return this.updateAppSettings({ "Permission Settings": settings });
  }

  /**
   * Validates that the current platform is iOS and provider is BrowserStack.
   * @private
   */
  private assertIOSBrowserStack(methodName: string): void {
    if (this.getPlatform() !== Platform.IOS) {
      throw new Error(
        `${methodName} is only supported on iOS platform. ` +
          `Current platform: ${this.getPlatform()}`,
      );
    }
    if (this.provider !== "browserstack") {
      throw new Error(
        `${methodName} is only supported with BrowserStack provider. ` +
          `Current provider: ${this.provider}. ` +
          `See https://www.browserstack.com/docs/app-automate/appium/advanced-features/ios-app-settings`,
      );
    }
  }
}
