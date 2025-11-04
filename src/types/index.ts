import { Device } from "../device";
import type { CreateRemoteAccessSessionConfiguration } from "@aws-sdk/client-device-farm";
import { z } from "zod";

export type ExtractType<T> = T extends z.ZodType ? z.infer<T> : never;

export type ActionOptions = {
  timeout: number;
};

export type TimeoutOptions = {
  /**
   * The maximum amount of time (in milliseconds) to wait for the condition to be met.
   */
  expectTimeout: number;
};

export interface DeviceProvider {
  /**
   * Identifier for the Appium session. Can be undefined if the session was not created.
   */
  sessionId?: string;

  /**
   * Global setup validates the configuration.
   */
  globalSetup?(): Promise<void>;

  /**
   * Returns a device instance.
   */
  getDevice(): Promise<Device>;

  /**
   * Updates test details and test status.
   *
   * @param status of the test
   * @param reason for the test status
   * @param name of the test
   */
  syncTestDetails?: (details: {
    status?: string;
    reason?: string;
    name?: string;
  }) => Promise<void>;
}

export type AppwrightConfig = {
  platform: Platform;
  device: DeviceConfig;
  buildPath: string;
  appBundleId: string;
  // TODO: use expect timeout from playwright config
  expectTimeout: number;
};

export type DeviceConfig =
  | BrowserStackConfig
  | LambdaTestConfig
  | LocalDeviceConfig
  | EmulatorConfig
  | AWSDeviceFarmConfig;

/**
 * Configuration for devices running on Browserstack.
 */
export type BrowserStackConfig = {
  provider: "browserstack";

  /**
   * The name of the device to be used on Browserstack.
   * Checkout the list of devices supported by BrowserStack: https://www.browserstack.com/list-of-browsers-and-platforms/app_automate
   * Example: "iPhone 15 Pro Max", "Samsung Galaxy S23 Ultra".
   */
  name: string;

  /**
   * The operating system version of the device to be used on Browserstack.
   * Checkout the list of OS versions supported by BrowserStack: https://www.browserstack.com/list-of-browsers-and-platforms/app_automate
   * Example: "14.0", "15.0".
   */
  osVersion: string;

  /**
   * The orientation of the device on Browserstack.
   * Default orientation is "portrait".
   */
  orientation?: DeviceOrientation;

  /**
   * Whether to enable camera injection on the device.
   * Default is false.
   */
  enableCameraImageInjection?: boolean;
};

export type LambdaTestConfig = {
  provider: "lambdatest";

  /**
   * The name of the device to be used on LambdaTest.
   * Checkout the list of devices supported by LambdaTest: https://www.lambdatest.com/list-of-real-devices
   * Example: "iPhone 15 Pro Max", "Galaxy S23 Ultra".
   */
  name: string;

  /**
   * The operating system version of the device to be used on LambdaTest.
   * Checkout the list of OS versions supported by LambdaTest: https://www.lambdatest.com/list-of-real-devices
   * Example: "14.0", "15.0".
   */
  osVersion: string;

  /**
   * The orientation of the device on LambdaTest.
   * Default orientation is "portrait".
   */
  orientation?: DeviceOrientation;

  /**
   * Whether to enable camera injection on the device.
   * Default is false.
   */
  enableCameraImageInjection?: boolean;
};

export type AWSDeviceFarmInteractionMode =
  | "INTERACTIVE"
  | "NO_VIDEO"
  | "VIDEO_ONLY";

export type AWSDeviceFarmConfig = {
  provider: "aws-device-farm";
  /**
   * ARN of the Device Farm project.
   */
  projectArn: string;
  /**
   * ARN of the device to target.
   */
  deviceArn: string;
  /**
   * Region to use when connecting to Device Farm. Defaults to us-west-2 if not provided.
   */
  region?: string;
  /**
   * Optional pre-uploaded application ARN. If omitted, Appwright will upload the build from `buildPath`.
   */
  appArn?: string;
  /**
   * When set, Device Farm records video for the remote session.
   */
  remoteRecordEnabled?: boolean;
  /**
   * Friendly name to apply to the remote session.
   */
  sessionName?: string;
  /**
   * Device Farm interaction mode to request. Defaults to VIDEO_ONLY.
   */
  interactionMode?: AWSDeviceFarmInteractionMode;
  /**
   * Forwarded to Device Farm's `configuration` field for advanced tuning.
   */
  configuration?: CreateRemoteAccessSessionConfiguration;
  /**
   * Skip resigning the uploaded application. Applies to private devices.
   */
  skipAppResign?: boolean;
  /**
   * Android package name of the application under test.
   */
  appPackage?: string;
  /**
   * Android launchable activity of the application under test.
   */
  appActivity?: string;
  /**
   * Any additional capabilities that should be merged into the Appium session.
   */
  additionalCapabilities?: Record<string, unknown>;
};

/**
 * Configuration for locally connected physical devices.
 */
export type LocalDeviceConfig = {
  provider: "local-device";
  name?: string;

  /**
   * The unique device identifier (UDID) of the connected local device.
   */
  udid?: string;

  /**
   * The orientation of the device.
   * Default orientation is "portrait".
   */
  orientation?: DeviceOrientation;
};

/**
 * Configuration for running tests on an Android or iOS emulator.
 */
export type EmulatorConfig = {
  provider: "emulator";
  name?: string;
  osVersion?: string;

  /**
   * The unique device identifier (UDID) of the emulator.
   */
  udid?: string;

  /**
   * The orientation of the emulator.
   * Default orientation is "portrait".
   */
  orientation?: DeviceOrientation;
};

export enum Platform {
  ANDROID = "android",
  IOS = "ios",
}

export enum DeviceOrientation {
  PORTRAIT = "portrait",
  LANDSCAPE = "landscape",
}

export enum ScrollDirection {
  UP = "up",
  DOWN = "down",
}

export interface AppwrightLocator {
  /**
   * Taps (clicks) on the element. This method waits for the element to be visible before clicking it.
   *
   * **Usage:**
   * ```js
   * await device.getByText("Submit").tap();
   * ```
   *
   * @param options Use this to override the timeout for this action
   */
  tap(options?: ActionOptions): Promise<void>;

  /**
   * Fills the input element with the given value. This method waits for the element to be visible before filling it.
   *
   * **Usage:**
   * ```js
   * await device.getByText("Search").fill("My query");
   * ```
   *
   * @param value The value to fill in the input field
   * @param options Use this to override the timeout for this action
   */
  fill(value: string, options?: ActionOptions): Promise<void>;

  /**
   * Sends key strokes to the element. This method waits for the element to be visible before sending the key strokes.
   *
   * **Usage:**
   * ```js
   * await device.getByText("Search").sendKeyStrokes("My query");
   * ```
   *
   * @param value The string to send as key strokes.
   * @param options Use this to override the timeout for this action
   */
  sendKeyStrokes(value: string, options?: ActionOptions): Promise<void>;

  /**
   * Wait for the element to be visible or attached, while attempting for the `timeout` duration.
   * Throws TimeoutError if element is not found within the timeout.
   *
   * **Usage:**
   * ```js
   * await device.getByText("Search").waitFor({ state: "visible" });
   * ```
   *
   * @param state The state to wait for
   * @param options Use this to override the timeout for this action
   */
  waitFor(
    state: "attached" | "visible",
    options?: ActionOptions,
  ): Promise<void>;

  /**
   * Waits for the element to be visible, while attempting for the `timeout` duration.
   * Returns boolean based on the visibility of the element.
   *
   * **Usage:**
   * ```js
   * const isVisible = await device.getByText("Search").isVisible();
   * ```
   *
   * @param options Use this to override the timeout for this action
   */
  isVisible(options?: ActionOptions): Promise<boolean>;

  /**
   * Returns the text content of the element. This method waits for the element to be visible before getting the text.
   *
   * **Usage:**
   * ```js
   * const textContent = await device.getByText("Search").getText();
   * ```
   *
   * @param options Use this to override the timeout for this action
   */
  getText(options?: ActionOptions): Promise<string>;

  scroll(direction: ScrollDirection): Promise<void>;
}

export enum WebDriverErrors {
  StaleElementReferenceError = "stale element reference",
}

export type ElementReference = Record<ElementReferenceId, string>;
export type ElementReferenceId = "element-6066-11e4-a52e-4f735466cecf";
