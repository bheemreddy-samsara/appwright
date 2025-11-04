import retry from "async-retry";
import fs from "fs";
import path from "path";
import { FullProject } from "@playwright/test";
import {
  AppwrightConfig,
  DeviceProvider,
  AWSDeviceFarmConfig,
  Platform,
} from "../../types";
import { Device } from "../../device";
import { logger } from "../../logger";
import {
  DeviceFarmClient,
  CreateUploadCommand,
  GetUploadCommand,
  UploadStatus,
  CreateRemoteAccessSessionCommand,
  GetRemoteAccessSessionCommand,
  StopRemoteAccessSessionCommand,
  ListArtifactsCommand,
  RemoteAccessSession,
} from "@aws-sdk/client-device-farm";
import { validateBuildPath } from "../../utils";

type UploadType = "ANDROID_APP" | "IOS_APP";

const DEFAULT_REGION = "us-west-2";

const envVarKeyForUpload = (projectName: string) =>
  `AWS_DEVICE_FARM_APP_ARN_${projectName.toUpperCase().replace(/-/g, "_")}`;

export class AWSDeviceFarmProvider implements DeviceProvider {
  sessionId?: string;
  private readonly project: FullProject<AppwrightConfig>;
  private readonly appBundleId: string | undefined;
  private readonly deviceConfig: AWSDeviceFarmConfig;
  private readonly platform: Platform;
  private readonly client: DeviceFarmClient;
  private uploadArn?: string;
  private remoteSessionArn?: string;

  constructor(
    project: FullProject<AppwrightConfig>,
    appBundleId: string | undefined,
  ) {
    this.project = project;
    this.appBundleId = appBundleId;
    this.deviceConfig = project.use.device as AWSDeviceFarmConfig;
    if (!project.use.platform) {
      throw new Error(
        "AWS Device Farm: `platform` must be specified in the project configuration.",
      );
    }
    this.platform = project.use.platform as Platform;

    if (!this.deviceConfig.projectArn) {
      throw new Error(
        "AWS Device Farm: `projectArn` is required in the device configuration.",
      );
    }
    if (!this.deviceConfig.deviceArn) {
      throw new Error(
        "AWS Device Farm: `deviceArn` is required in the device configuration.",
      );
    }
    if (!this.deviceConfig.region && !process.env.AWS_REGION) {
      logger.warn(
        "AWS Device Farm: region not specified. Falling back to us-west-2.",
      );
    }
    if (this.platform === Platform.IOS && !this.appBundleId) {
      throw new Error(
        "AWS Device Farm: `appBundleId` is required for iOS projects.",
      );
    }

    const region =
      this.deviceConfig.region ?? process.env.AWS_REGION ?? DEFAULT_REGION;
    this.client = new DeviceFarmClient({ region });

    // Priority order for upload ARN:
    // 1. Explicit appArn from device config (highest priority)
    // 2. Persisted ARN from environment variable (for shared instances)
    if (this.deviceConfig.appArn) {
      // Use explicit appArn from config
      this.uploadArn = this.deviceConfig.appArn;
    } else {
      // Check for persisted upload ARN from a previous globalSetup
      const envVarKey = envVarKeyForUpload(this.project.name);
      const persistedArn = process.env[envVarKey];
      if (persistedArn) {
        this.uploadArn = persistedArn;
        logger.log(
          `AWS Device Farm: Using persisted app ARN from previous upload: ${persistedArn}`,
        );
      }
    }
  }

  async globalSetup(): Promise<void> {
    const buildPath = this.project.use.buildPath;
    const providedAppArn = this.deviceConfig.appArn;

    if (!buildPath && !providedAppArn) {
      throw new Error(
        "AWS Device Farm: Either provide `buildPath` or `appArn` in the configuration.",
      );
    }

    if (buildPath) {
      this.validateBuildFile(buildPath);
      this.uploadArn = await this.uploadApplication(buildPath);
    } else {
      this.uploadArn = providedAppArn;
    }

    // Persist the upload ARN for future provider instances
    const envVarKey = envVarKeyForUpload(this.project.name);
    process.env[envVarKey] = this.uploadArn;
    logger.log(
      `AWS Device Farm: Persisted app ARN for project "${this.project.name}": ${this.uploadArn}`,
    );
  }

  async getDevice(): Promise<Device> {
    const remoteSession = await this.createRemoteSession();
    const endpointUrl = this.normalizeEndpoint(remoteSession);
    const capabilities = this.buildCapabilities(remoteSession);
    const WebDriver = (await import("webdriver")).default;

    const connectionOptions: any = {
      protocol: endpointUrl.protocol.replace(":", ""),
      hostname: endpointUrl.hostname,
      port: endpointUrl.port
        ? Number(endpointUrl.port)
        : endpointUrl.protocol === "https:"
          ? 443
          : 80,
      path: endpointUrl.pathname,
    };

    // Add query parameters if present
    if (endpointUrl.search) {
      // Parse query string into an object
      const queryParams: Record<string, string> = {};
      const searchParams = new URLSearchParams(endpointUrl.search);
      searchParams.forEach((value, key) => {
        queryParams[key] = value;
      });
      connectionOptions.queryParams = queryParams;
    }

    let webDriverClient;
    try {
      webDriverClient = await WebDriver.newSession({
        ...connectionOptions,
        capabilities: {
          alwaysMatch: capabilities,
          firstMatch: [{}],
        },
      });
    } catch (error) {
      // Clean up the remote session if WebDriver connection fails
      await this.stopRemoteSession();
      throw error;
    }

    this.sessionId = this.remoteSessionArn ?? webDriverClient.sessionId;

    const testOptions = {
      expectTimeout: this.project.use.expectTimeout!,
    };

    return new Device(
      webDriverClient,
      this.appBundleId,
      testOptions,
      this.project.use.device?.provider!,
      this,
      async () => {
        await this.stopRemoteSession();
      },
    );
  }

  async syncTestDetails(): Promise<void> {
    // AWS Device Farm does not currently expose an API to update session metadata like name or status.
    // This is a no-op to satisfy the DeviceProvider interface.
    return;
  }

  private validateBuildFile(buildPath: string) {
    const expectedExtension =
      this.platform === Platform.ANDROID ? ".apk" : ".ipa";
    validateBuildPath(buildPath, expectedExtension);
    if (!fs.existsSync(buildPath)) {
      throw new Error(`AWS Device Farm: build file not found at ${buildPath}`);
    }
  }

  private async uploadApplication(buildPath: string): Promise<string> {
    const uploadType: UploadType =
      this.platform === Platform.ANDROID ? "ANDROID_APP" : "IOS_APP";
    const fileName = path.basename(buildPath);

    const createUploadResponse = await this.client.send(
      new CreateUploadCommand({
        name: fileName,
        projectArn: this.deviceConfig.projectArn,
        type: uploadType,
        contentType: "application/octet-stream",
      }),
    );

    const upload = createUploadResponse.upload;

    if (!upload?.url || !upload?.arn) {
      throw new Error(
        "AWS Device Farm: Failed to create upload. Upload URL or ARN missing.",
      );
    }

    const fetch = (await import("node-fetch")).default;
    const fileStream = fs.createReadStream(buildPath);
    const putResponse = await fetch(upload.url, {
      method: "PUT",
      headers: {
        "Content-Type": "application/octet-stream",
      },
      body: fileStream,
    });

    if (!putResponse.ok) {
      throw new Error(
        `AWS Device Farm: Upload failed with status ${putResponse.status} ${putResponse.statusText}`,
      );
    }

    await this.waitForUploadProcessing(upload.arn);
    logger.log(
      `AWS Device Farm: Uploaded ${fileName} (${upload.arn}) successfully.`,
    );
    return upload.arn;
  }

  private async waitForUploadProcessing(uploadArn: string): Promise<void> {
    await retry(
      async (bail) => {
        const { upload } = await this.client.send(
          new GetUploadCommand({ arn: uploadArn }),
        );
        if (!upload) {
          return bail(
            new Error(
              "AWS Device Farm: Unable to fetch upload status after upload.",
            ),
          );
        }
        if (upload.status === UploadStatus.FAILED) {
          return bail(
            new Error(
              `AWS Device Farm: Upload processing failed. Reason: ${upload.message}`,
            ),
          );
        }
        if (upload.status === UploadStatus.SUCCEEDED) {
          return;
        }
        throw new Error(
          `AWS Device Farm: Upload still processing (status: ${upload.status}).`,
        );
      },
      {
        retries: 20,
        minTimeout: 5_000,
        maxTimeout: 15_000,
      },
    );
  }

  private async createRemoteSession(): Promise<RemoteAccessSession> {
    const createSessionResponse = await this.client.send(
      new CreateRemoteAccessSessionCommand({
        projectArn: this.deviceConfig.projectArn,
        deviceArn: this.deviceConfig.deviceArn,
        appArn: this.uploadArn,
        interactionMode: this.deviceConfig.interactionMode ?? "VIDEO_ONLY",
        remoteRecordEnabled: this.deviceConfig.remoteRecordEnabled ?? true,
        name:
          this.deviceConfig.sessionName ?? `${this.project.name}-${Date.now()}`,
        skipAppResign: this.deviceConfig.skipAppResign ?? false,
        configuration: this.deviceConfig.configuration,
      }),
    );

    const remoteSession = createSessionResponse.remoteAccessSession;
    if (!remoteSession?.arn) {
      throw new Error(
        "AWS Device Farm: Remote access session ARN was not returned.",
      );
    }

    this.remoteSessionArn = remoteSession.arn;

    const session = await this.waitForRemoteSession(remoteSession.arn);
    if (!session.endpoint) {
      throw new Error(
        "AWS Device Farm: Remote access session endpoint not available.",
      );
    }
    return session;
  }

  private async waitForRemoteSession(
    sessionArn: string,
  ): Promise<RemoteAccessSession> {
    return await retry<RemoteAccessSession>(
      async (bail) => {
        const { remoteAccessSession } = await this.client.send(
          new GetRemoteAccessSessionCommand({
            arn: sessionArn,
          }),
        );
        if (!remoteAccessSession) {
          const error = new Error(
            "AWS Device Farm: Remote access session not found.",
          );
          bail(error);
          throw error;
        }
        if (
          remoteAccessSession.status === "COMPLETED" ||
          remoteAccessSession.status === "STOPPING"
        ) {
          const error = new Error(
            `AWS Device Farm: Remote access session ended before it became RUNNING (result: ${remoteAccessSession.result ?? "unknown"}).`,
          );
          bail(error);
          throw error;
        }
        if (remoteAccessSession.status !== "RUNNING") {
          throw new Error(
            `AWS Device Farm: Waiting for remote session to be ready (status: ${remoteAccessSession.status}).`,
          );
        }
        return remoteAccessSession;
      },
      {
        retries: 30,
        minTimeout: 10_000,
        maxTimeout: 20_000,
      },
    );
  }

  private normalizeEndpoint(session: RemoteAccessSession): URL {
    if (!session.endpoint) {
      throw new Error(
        "AWS Device Farm: Remote access session endpoint missing.",
      );
    }
    const url = new URL(session.endpoint);
    if (url.protocol === "wss:") {
      url.protocol = "https:";
    }
    const sanitizedPath = url.pathname.endsWith("/")
      ? url.pathname.slice(0, -1)
      : url.pathname;
    if (!sanitizedPath.endsWith("/wd/hub")) {
      url.pathname = `${sanitizedPath}/wd/hub`;
    }
    return url;
  }

  private buildCapabilities(
    session: RemoteAccessSession,
  ): Record<string, unknown> {
    const isAndroid = this.platform === Platform.ANDROID;
    const automationName = isAndroid ? "UiAutomator2" : "XCUITest";

    const capabilities: Record<string, unknown> = {
      platformName: isAndroid ? "Android" : "iOS",
      "appium:automationName": automationName,
      "appium:newCommandTimeout": 240,
      "appium:noReset": false,
    };

    // CRITICAL: Include app capability for Appium to work
    // This is required when appPackage/appActivity are not provided
    if (this.uploadArn) {
      capabilities["appium:app"] = this.uploadArn;
    }

    if (session.device?.name) {
      capabilities["appium:deviceName"] = session.device.name;
    }

    if (session.device?.os) {
      capabilities["appium:platformVersion"] = session.device.os;
    }

    if (this.appBundleId && !isAndroid) {
      capabilities["appium:bundleId"] = this.appBundleId;
    }

    if (this.deviceConfig.appPackage) {
      capabilities["appium:appPackage"] = this.deviceConfig.appPackage;
    }

    if (this.deviceConfig.appActivity) {
      capabilities["appium:appActivity"] = this.deviceConfig.appActivity;
    }

    if (this.deviceConfig.additionalCapabilities) {
      Object.assign(capabilities, this.deviceConfig.additionalCapabilities);
    }

    return capabilities;
  }

  static async downloadVideo(
    sessionArn: string,
    outputDir: string,
    fileName: string,
  ): Promise<{ path: string; contentType: string } | null> {
    if (!sessionArn) {
      logger.warn(
        "AWS Device Farm: session ARN missing, skipping video download.",
      );
      return null;
    }

    const region =
      AWSDeviceFarmProvider.extractRegionFromArn(sessionArn) ??
      process.env.AWS_REGION ??
      DEFAULT_REGION;
    const client = new DeviceFarmClient({ region });
    const pathToVideo = path.join(outputDir, `${fileName}.mp4`);
    const tempPath = `${pathToVideo}.part`;
    const dir = path.dirname(pathToVideo);
    fs.mkdirSync(dir, { recursive: true });

    try {
      const downloadResult = await retry(
        async () => {
          const artifact = await AWSDeviceFarmProvider.findVideoArtifact(
            client,
            sessionArn,
          );
          if (!artifact?.url) {
            throw new Error("AWS Device Farm: Video artifact not ready yet.");
          }

          if (fs.existsSync(tempPath)) {
            fs.rmSync(tempPath, { force: true });
          }

          await AWSDeviceFarmProvider.downloadFromPresignedUrl(
            artifact.url,
            tempPath,
          );
          if (fs.existsSync(pathToVideo)) {
            fs.rmSync(pathToVideo, { force: true });
          }
          fs.renameSync(tempPath, pathToVideo);
          return { path: pathToVideo, contentType: "video/mp4" } as const;
        },
        {
          retries: 10,
          minTimeout: 5_000,
          maxTimeout: 15_000,
          onRetry: (error, attempt) => {
            if (attempt > 3) {
              logger.warn(
                `AWS Device Farm: retrying video download (attempt ${attempt}): ${error.message}`,
              );
            }
          },
        },
      );
      return downloadResult;
    } catch (error) {
      logger.error("AWS Device Farm: Failed to download video.", error);
      return null;
    } finally {
      client.destroy();
      if (fs.existsSync(tempPath)) {
        try {
          fs.rmSync(tempPath, { force: true });
        } catch (cleanupError) {
          logger.warn(
            "AWS Device Farm: Unable to clean up temporary video file.",
            cleanupError,
          );
        }
      }
    }
  }

  private static async findVideoArtifact(
    client: DeviceFarmClient,
    sessionArn: string,
  ) {
    const artifactTypesToCheck = ["FILE", "LOG"] as const;
    for (const type of artifactTypesToCheck) {
      let nextToken: string | undefined;
      do {
        const response = await client.send(
          new ListArtifactsCommand({
            arn: sessionArn,
            type,
            nextToken,
          }),
        );
        const artifacts = response.artifacts ?? [];
        const videoArtifact = artifacts.find((artifact) => {
          const artifactType = artifact.type ?? "";
          return artifactType === "VIDEO" || artifactType === "VIDEO_LOG";
        });
        if (videoArtifact) {
          return videoArtifact;
        }
        nextToken = response.nextToken;
      } while (nextToken);
    }
    return undefined;
  }

  private static async downloadFromPresignedUrl(
    url: string,
    tempPath: string,
  ): Promise<void> {
    const fetch = (await import("node-fetch")).default;
    const response = await fetch(url, {
      method: "GET",
    });
    if (!response.ok) {
      throw new Error(
        `AWS Device Farm: Unable to fetch video artifact. Status ${response.status}`,
      );
    }

    // node-fetch v3 returns a Node.js Readable stream, not a Web Stream
    // We can directly pipe it to the file
    const { pipeline } = await import("stream/promises");
    const fileStream = fs.createWriteStream(tempPath);

    // Use pipeline to handle the stream properly with automatic cleanup
    await pipeline(response.body as any, fileStream);
  }

  private static extractRegionFromArn(arn: string): string | undefined {
    const arnParts = arn.split(":");
    if (arnParts.length >= 4 && arnParts[2] === "devicefarm") {
      return arnParts[3] || undefined;
    }
    return undefined;
  }

  private async stopRemoteSession(): Promise<void> {
    if (!this.remoteSessionArn) {
      return;
    }
    try {
      await this.client.send(
        new StopRemoteAccessSessionCommand({
          arn: this.remoteSessionArn,
        }),
      );
    } catch (error) {
      logger.warn(
        `AWS Device Farm: Failed to stop remote access session (${String(error)})`,
      );
    }
  }
}
