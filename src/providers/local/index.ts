import {
  AppwrightConfig,
  DeviceProvider,
  LocalDeviceConfig,
  Platform,
  TimeoutOptions,
} from "../../types";
import { Device } from "../../device";
import { FullProject } from "@playwright/test";
import {
  getActiveAndroidDevices,
  getApkDetails,
  getAppBundleId,
  getConnectedIOSDeviceUDID,
  installDriver,
  startAppiumServer,
} from "../appium";
import { applyAppiumSettingsToCapabilities } from "../appiumSettings";
import { validateBuildPath } from "../../utils";
import { logger } from "../../logger";

export class LocalDeviceProvider implements DeviceProvider {
  sessionId?: string;

  constructor(
    private project: FullProject<AppwrightConfig>,
    appBundleId: string | undefined,
  ) {
    if (appBundleId) {
      logger.log(
        `Bundle id is specified (${appBundleId}) but ignored for local device provider.`,
      );
    }
  }

  async getDevice(): Promise<Device> {
    return await this.createDriver();
  }

  async globalSetup() {
    validateBuildPath(
      this.project.use.buildPath,
      this.project.use.platform == Platform.ANDROID ? ".apk" : ".ipa",
    );
    if (this.project.use.platform == Platform.ANDROID) {
      const androidHome = process.env.ANDROID_HOME;

      if (!androidHome) {
        return Promise.reject(
          "The ANDROID_HOME environment variable is not set. This variable is required to locate your Android SDK. Please set it to the correct path of your Android SDK installation. For detailed instructions on how to set up the Android SDK path, visit: https://developer.android.com/tools",
        );
      }
    }
  }

  private async createDriver(): Promise<Device> {
    await installDriver(
      this.project.use.platform == Platform.ANDROID
        ? "uiautomator2"
        : "xcuitest",
    );
    await startAppiumServer(this.project.use.device?.provider!);
    const WebDriver = (await import("webdriver")).default;
    const webDriverClient = await WebDriver.newSession(
      await this.createConfig(),
    );
    this.sessionId = webDriverClient.sessionId;
    const bundleId = await getAppBundleId(this.project.use.buildPath!);
    const expectTimeout = this.project.use.expectTimeout!;
    const testOptions: TimeoutOptions = {
      expectTimeout,
    };
    return new Device(
      webDriverClient,
      bundleId,
      testOptions,
      this.project.use.device?.provider!,
      this,
      undefined,
      this.project.use.gptDriver,
    );
  }

  private async createConfig() {
    const platformName = this.project.use.platform;
    if (!this.project.use.device) {
      throw new Error(
        "Device configuration is required for local device provider.",
      );
    }
    const deviceConfig = this.project.use.device as LocalDeviceConfig;
    const appiumSettings = deviceConfig.appiumSettings;
    let appPackageName: string | undefined;
    let appLaunchableActivity: string | undefined;

    if (platformName == Platform.ANDROID) {
      const { packageName, launchableActivity } = await getApkDetails(
        this.project.use.buildPath!,
      );
      appPackageName = packageName!;
      appLaunchableActivity = launchableActivity!;
    }
    let udid = deviceConfig.udid;
    if (!udid) {
      if (platformName == Platform.IOS) {
        udid = await getConnectedIOSDeviceUDID();
      } else {
        const activeAndroidDevices = await getActiveAndroidDevices();
        if (activeAndroidDevices > 1) {
          logger.warn(
            `Multiple active devices detected. Selecting one for the test.
To specify a device, use the udid property. Run "adb devices" to get the UDID for active devices.`,
          );
        }
      }
    }

    // Build capabilities with configurable appium settings
    const capabilities: Record<string, unknown> = {
      "appium:deviceName": deviceConfig.name,
      "appium:udid": udid,
      "appium:automationName":
        platformName == Platform.ANDROID ? "uiautomator2" : "xcuitest",
      platformName: platformName,
      "appium:autoGrantPermissions": true,
      "appium:app": this.project.use.buildPath,
      "appium:autoAcceptAlerts": true,
      "appium:fullReset": true,
      "appium:deviceOrientation": deviceConfig.orientation,
    };

    if (platformName == Platform.ANDROID) {
      capabilities["appium:appActivity"] = appLaunchableActivity;
      capabilities["appium:appPackage"] = appPackageName;
      capabilities["appium:settings[snapshotMaxDepth]"] =
        appiumSettings?.snapshotMaxDepth ?? 62;
    }

    applyAppiumSettingsToCapabilities(
      capabilities,
      appiumSettings,
      platformName,
    );

    return {
      port: 4723,
      capabilities,
    };
  }
}
