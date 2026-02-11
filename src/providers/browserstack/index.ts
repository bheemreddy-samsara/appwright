import retry from "async-retry";
import fs from "fs";
import FormData from "form-data";
import path from "path";
import {
  AppwrightConfig,
  DeviceProvider,
  BrowserStackConfig,
  Platform,
} from "../../types";
import { FullProject } from "@playwright/test";
import { Device } from "../../device";
import { logger } from "../../logger";
import { downloadS3Artifact, isS3Uri, type DownloadedS3Artifact } from "./s3";
import {
  applyAppiumSettingsToCapabilities,
  buildAppiumUpdateSettings,
} from "../appiumSettings";

type BrowserStackSessionDetails = {
  name: string;
  duration: number;
  os: string;
  os_version: string;
  device: string;
  status: string;
  reason: string;
  build_name: string;
  project_name: string;
  logs: string;
  public_url: string;
  appium_logs_url: string;
  video_url: string;
  device_logs_url: string;
  app_details: {
    app_url: string;
    app_name: string;
    app_version: string;
    app_custom_id: string;
    uploaded_at: string;
  };
};

const API_BASE_URL = "https://api-cloud.browserstack.com/app-automate";

const envVarKeyForBuild = (projectName: string) =>
  `BROWSERSTACK_APP_URL_${projectName.toUpperCase()}`;

function getAuthHeader() {
  const userName = process.env.BROWSERSTACK_USERNAME;
  const accessKey = process.env.BROWSERSTACK_ACCESS_KEY;
  const key = Buffer.from(`${userName}:${accessKey}`).toString("base64");
  return `Basic ${key}`;
}

async function getSessionDetails(sessionId: string) {
  const response = await fetch(`${API_BASE_URL}/sessions/${sessionId}.json`, {
    method: "GET",
    headers: {
      Authorization: getAuthHeader(),
    },
  });
  if (!response.ok) {
    throw new Error(`Error fetching session details: ${response.statusText}`);
  }
  const data = await response.json();
  return data;
}

export class BrowserStackDeviceProvider implements DeviceProvider {
  private sessionDetails?: BrowserStackSessionDetails;
  sessionId?: string;
  private project: FullProject<AppwrightConfig>;

  constructor(
    project: FullProject<AppwrightConfig>,
    appBundleId: string | undefined,
  ) {
    this.project = project;
    if (appBundleId) {
      logger.log(
        `Bundle id is specified (${appBundleId}) but ignored for BrowserStack provider.`,
      );
    }
  }

  async globalSetup() {
    if (!this.project.use.buildPath) {
      throw new Error(
        `Build path not found. Please set the build path in the config file.`,
      );
    }
    if (
      !(
        process.env.BROWSERSTACK_USERNAME && process.env.BROWSERSTACK_ACCESS_KEY
      )
    ) {
      throw new Error(
        "BROWSERSTACK_USERNAME and BROWSERSTACK_ACCESS_KEY are required environment variables for this device provider.",
      );
    }
    const buildPath = this.project.use.buildPath!;
    const isS3Url = isS3Uri(buildPath);
    const isHttpUrl = !isS3Url && buildPath.startsWith("http");
    const isBrowserStackUrl = buildPath.startsWith("bs://");
    let appUrl: string | undefined = undefined;
    let downloadedArtifact: DownloadedS3Artifact | undefined;

    try {
      if (isBrowserStackUrl) {
        appUrl = buildPath;
      } else {
        // Upload the file to BrowserStack and get the appUrl
        let body;
        let headers = {
          Authorization: getAuthHeader(),
        };
        let uploadSource = buildPath;

        if (isS3Url) {
          logger.log(`Downloading build from S3: ${buildPath}`);
          downloadedArtifact = await downloadS3Artifact(buildPath);
          uploadSource = downloadedArtifact.filePath;
        }

        if (isHttpUrl) {
          body = new URLSearchParams({
            url: buildPath,
          });
        } else {
          if (!fs.existsSync(uploadSource)) {
            throw new Error(`Build file not found: ${uploadSource}`);
          }
          const form = new FormData();
          form.append("file", fs.createReadStream(uploadSource));
          headers = { ...headers, ...form.getHeaders() };
          body = form;
        }
        const fetch = (await import("node-fetch")).default;
        logger.log(`Uploading build to BrowserStack: ${uploadSource}`);
        const response = await fetch(`${API_BASE_URL}/upload`, {
          method: "POST",
          headers,
          body,
        });
        const data = await response.json();
        appUrl = (data as any).app_url;
        if (!appUrl) {
          logger.error("Uploading the build failed:", data);
          throw new Error(
            `Failed to upload build to BrowserStack: ${JSON.stringify(data)}`,
          );
        }
      }
    } finally {
      await downloadedArtifact?.cleanup();
    }
    process.env[envVarKeyForBuild(this.project.name)] = appUrl;
  }

  async getDevice(): Promise<Device> {
    this.validateConfig();
    const config = this.createConfig();
    return await this.createDriver(config);
  }

  private validateConfig() {
    const device = this.project.use.device as BrowserStackConfig;
    if (!device.name || !device.osVersion) {
      throw new Error(
        "Device name and osVersion are required for running tests on BrowserStack",
      );
    }
  }

  private async createDriver(config: any): Promise<Device> {
    const WebDriver = (await import("webdriver")).default;
    const webDriverClient = await WebDriver.newSession(config);
    const deviceConfig = this.project.use.device as BrowserStackConfig;
    const platformName = this.project.use.platform;
    const updateSettings = buildAppiumUpdateSettings(
      deviceConfig?.appiumSettings,
      platformName,
    );
    if (updateSettings) {
      try {
        await webDriverClient.updateSettings(updateSettings);
        logger.log("Applied Appium settings via updateSettings.");
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(
          `Failed to apply appiumSettings via updateSettings: ${message}`,
        );
      }
    }
    this.sessionId = webDriverClient.sessionId;
    const bundleId = await this.getAppBundleIdFromSession();
    const testOptions = {
      expectTimeout: this.project.use.expectTimeout!,
    };
    return new Device(
      webDriverClient,
      bundleId,
      testOptions,
      this.project.use.device?.provider!,
      this,
    );
  }

  private async getSessionDetails() {
    const data = await getSessionDetails(this.sessionId!);
    this.sessionDetails = data.automation_session;
  }

  private async getAppBundleIdFromSession(): Promise<string> {
    await this.getSessionDetails();
    return this.sessionDetails?.app_details.app_name ?? "";
  }

  static async downloadVideo(
    sessionId: string,
    outputDir: string,
    fileName: string,
  ): Promise<{ path: string; contentType: string } | null> {
    if (process.env.APPWRIGHT_DISABLE_VIDEO_DOWNLOAD === "true") {
      logger.log(
        "BrowserStack video download disabled via APPWRIGHT_DISABLE_VIDEO_DOWNLOAD.",
      );
      return null;
    }
    const sessionData = await getSessionDetails(sessionId);
    const sessionDetails = sessionData?.automation_session;
    const videoURL = sessionDetails?.video_url;
    const pathToTestVideo = path.join(outputDir, `${fileName}.mp4`);
    const tempPathForWriting = `${pathToTestVideo}.part`;
    const dir = path.dirname(pathToTestVideo);
    fs.mkdirSync(dir, { recursive: true });
    /**
     * The BrowserStack video URL initially returns a 200 status,
     * but the video file may still be empty. To avoid downloading
     * an incomplete file, we introduce a delay of 10_000 ms before attempting the download.
     * After the wait, BrowserStack may return a 403 error if the video is not
     * yet available. We handle this by retrying the download until we either
     * receive a 200 response (indicating the video is ready) or reach a maximum
     * of 10 retries, whichever comes first.
     */
    await new Promise((resolve) => setTimeout(resolve, 10_000));
    //To catch the browserstack error in case all retries fails
    try {
      if (videoURL) {
        logger.log(
          `[${new Date().toISOString()}] Video download starting: ${videoURL}`,
        );
        await retry(
          async () => {
            const response = await fetch(videoURL, {
              method: "GET",
            });
            if (response.status !== 200) {
              // Retry if not 200
              throw new Error(
                `Video not found: ${response.status} (URL: ${videoURL})`,
              );
            }
            const reader = response.body?.getReader();
            if (!reader) {
              throw new Error("Failed to get reader from response body.");
            }
            // Create a fresh write stream on each attempt to avoid
            // appending corrupt data from previous failed retries
            const fileStream = fs.createWriteStream(tempPathForWriting);
            // Register finish/error listeners before any writes so errors
            // during the loop are captured and finish always resolves.
            const streamDone = new Promise<void>((resolve, reject) => {
              fileStream.on("finish", resolve);
              fileStream.on("error", reject);
            });
            try {
              while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                if (!fileStream.write(value)) {
                  // Back-pressure: wait for drain before continuing
                  await new Promise<void>((r) => fileStream.once("drain", r));
                }
              }
              fileStream.end();
              await streamDone;
            } catch (err) {
              fileStream.destroy();
              throw err;
            }
          },
          {
            retries: 10,
            minTimeout: 3_000,
            maxTimeout: 60_000,
            onRetry: (err, i) => {
              const message = err instanceof Error ? err.message : String(err);
              logger.warn(
                `[${new Date().toISOString()}] Video download retry ${i}/10 failed: ${message}`,
              );
            },
          },
        );
        fs.renameSync(tempPathForWriting, pathToTestVideo);
        logger.log(
          `[${new Date().toISOString()}] Video download completed: ${pathToTestVideo}`,
        );
        return { path: pathToTestVideo, contentType: "video/mp4" };
      } else {
        return null;
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      logger.warn(
        `[${new Date().toISOString()}] Video download failed after all retries: ${message}. Test will complete without video attachment.`,
      );
      return null;
    }
  }

  async syncTestDetails(details: {
    status?: string;
    reason?: string;
    name?: string;
  }) {
    const response = await fetch(
      `${API_BASE_URL}/sessions/${this.sessionId}.json`,
      {
        method: "PUT",
        headers: {
          Authorization: getAuthHeader(),
          "Content-Type": "application/json",
        },
        body: details.status
          ? JSON.stringify({
              status: details.status,
              reason: details.reason,
            })
          : JSON.stringify({
              name: details.name,
            }),
      },
    );
    if (!response.ok) {
      throw new Error(`Error setting session details: ${response.statusText}`);
    }

    const responseData = await response.json();
    return responseData;
  }

  private createConfig() {
    const platformName = this.project.use.platform;
    const projectName = path.basename(process.cwd());
    const envVarKey = envVarKeyForBuild(this.project.name);
    const deviceConfig = this.project.use.device as BrowserStackConfig;
    const configuredAppiumVersion =
      deviceConfig.appiumVersion ??
      process.env.BROWSERSTACK_APPIUM_VERSION ??
      "3.1.0";
    if (!process.env[envVarKey]) {
      throw new Error(
        `process.env.${envVarKey} is not set. Did the file upload work?`,
      );
    }
    const permissionPrompts = deviceConfig?.permissionPrompts;

    // Build CI-aware metadata for better traceability between CI builds and BrowserStack sessions
    const ciBuildIdentifier =
      process.env.BUILDKITE_BUILD_ID ||
      process.env.GITHUB_RUN_ID ||
      process.env.CI_JOB_ID || // GitLab CI
      process.env.USER;

    const ciBuildNumber =
      process.env.BUILDKITE_BUILD_NUMBER ||
      process.env.GITHUB_RUN_NUMBER ||
      process.env.CI_PIPELINE_IID; // GitLab CI

    const ciBranch =
      process.env.BUILDKITE_BRANCH ||
      process.env.GITHUB_REF_NAME ||
      process.env.CI_COMMIT_REF_NAME; // GitLab CI

    const ciCommit = (
      process.env.BUILDKITE_COMMIT ||
      process.env.GITHUB_SHA ||
      process.env.CI_COMMIT_SHA
    ) // GitLab CI
      ?.substring(0, 7);

    // Allow env var override, otherwise build a descriptive name with CI context
    const defaultBuildName = ciBuildNumber
      ? `${projectName} ${platformName} #${ciBuildNumber}${ciBranch ? ` (${ciBranch})` : ""}`
      : `${projectName} ${platformName}`;

    const defaultSessionName = ciCommit
      ? `${projectName} ${platformName} test @ ${ciCommit}`
      : `${projectName} ${platformName} test`;

    const bstackOptions: Record<string, unknown> = {
      debug: true,
      interactiveDebugging: true,
      appiumVersion: configuredAppiumVersion,
      enableCameraImageInjection: deviceConfig?.enableCameraImageInjection,
      idleTimeout: deviceConfig?.idleTimeout ?? 180,
      deviceName: deviceConfig?.name,
      osVersion: deviceConfig.osVersion,
      platformName: platformName,
      deviceOrientation: deviceConfig?.orientation,
      buildName: process.env.BROWSERSTACK_BUILD_NAME || defaultBuildName,
      sessionName: process.env.BROWSERSTACK_SESSION_NAME || defaultSessionName,
      buildIdentifier: ciBuildIdentifier,
    };

    bstackOptions.networkLogs = deviceConfig?.networkLogs ?? true;

    if (deviceConfig?.networkLogsOptions) {
      if (!deviceConfig?.networkLogs) {
        logger.warn(
          "networkLogsOptions is set but networkLogs is not enabled. " +
            "Set networkLogs: true for these options to take effect.",
        );
      }
      bstackOptions.networkLogsOptions = deviceConfig.networkLogsOptions;
    }

    if (typeof deviceConfig?.appProfiling === "boolean") {
      bstackOptions.appProfiling = deviceConfig.appProfiling;
    }

    if (deviceConfig?.geoLocation) {
      bstackOptions.geoLocation = deviceConfig.geoLocation;
    }

    if (deviceConfig?.gpsLocation) {
      bstackOptions.gpsLocation = deviceConfig.gpsLocation;
    }

    // iOS App Settings support (capability-based for session start)
    if (platformName === Platform.IOS) {
      // Support environment variable override for CI/CD
      const envSettingsJson = process.env.APPWRIGHT_BS_UPDATE_APP_SETTINGS_JSON;
      let updateAppSettings: unknown;
      if (envSettingsJson) {
        try {
          updateAppSettings = JSON.parse(envSettingsJson);
        } catch (e) {
          throw new Error(
            "APPWRIGHT_BS_UPDATE_APP_SETTINGS_JSON is not valid JSON. " +
              "Provide a valid JSON string.",
          );
        }
      } else {
        updateAppSettings = deviceConfig?.updateAppSettings;
      }

      if (updateAppSettings && typeof updateAppSettings === "object") {
        const settings = updateAppSettings as Record<string, unknown>;
        const hasPermissions = !!settings["Permission Settings"];
        const customKeys = Object.keys(settings).filter(
          (key) => key !== "Permission Settings",
        );
        if (hasPermissions || customKeys.length > 0) {
          logger.log(
            "iOS app settings detected; they will be applied after session start via fixtures.",
          );
        }
      }
    }

    const capabilities: Record<string, unknown> = {
      "bstack:options": bstackOptions,
      "appium:app": process.env[envVarKey],
      "appium:fullReset": true,
    };

    if (platformName === Platform.ANDROID) {
      capabilities["appium:settings[snapshotMaxDepth]"] =
        deviceConfig.appiumSettings?.snapshotMaxDepth ?? 62;
    }

    applyAppiumSettingsToCapabilities(
      capabilities,
      deviceConfig.appiumSettings,
      platformName,
      {
        includeBrowserStackSettings: true,
        includeUpdateSettingsCapabilities: false,
      },
    );

    if (platformName === Platform.ANDROID) {
      const grantPreference = permissionPrompts?.android?.grantPermissions;
      if (grantPreference !== "manual") {
        capabilities["appium:autoGrantPermissions"] =
          typeof grantPreference === "boolean" ? grantPreference : true;
      }
    }

    if (platformName === Platform.IOS) {
      const iosBehavior = permissionPrompts?.ios?.behavior ?? "accept";
      if (iosBehavior !== "manual") {
        const osVersionNumeric = parseFloat(deviceConfig.osVersion);
        const isFlipped =
          !Number.isNaN(osVersionNumeric) && osVersionNumeric >= 13;
        const acceptKey = isFlipped
          ? "appium:autoDismissAlerts"
          : "appium:autoAcceptAlerts";
        const dismissKey = isFlipped
          ? "appium:autoAcceptAlerts"
          : "appium:autoDismissAlerts";

        if (iosBehavior === "accept") {
          capabilities[acceptKey] = true;
        }

        if (iosBehavior === "dismiss") {
          capabilities[dismissKey] = true;
        }
      }
    }

    return {
      port: 443,
      path: "/wd/hub",
      protocol: "https",
      logLevel: "warn",
      user: process.env.BROWSERSTACK_USERNAME,
      key: process.env.BROWSERSTACK_ACCESS_KEY,
      hostname: "hub.browserstack.com",
      capabilities,
    };
  }
}
