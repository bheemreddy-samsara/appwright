import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { AWSDeviceFarmProvider } from "./index";
import * as fs from "fs";
import { logger } from "../../logger";
//@ts-ignore
import { DeviceFarmClient } from "@aws-sdk/client-device-farm";

// Create a mock fetch function
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

// Mock utils module
vi.mock("../../utils", async () => {
  const actual =
    await vi.importActual<typeof import("../../utils")>("../../utils");
  return {
    ...actual,
    validateBuildPath: vi.fn(),
  };
});

// Mock async-retry
vi.mock("async-retry", () => ({
  default: vi.fn((fn) => fn()),
}));

// Mock node-fetch
vi.mock("node-fetch", () => ({
  default: mockFetch,
}));

// Mock stream/promises pipeline
vi.mock("stream/promises", () => ({
  pipeline: vi.fn().mockResolvedValue(undefined),
}));

// Mock webdriver
vi.mock("webdriver", () => ({
  default: {
    newSession: vi.fn().mockResolvedValue({
      sessionId: "test-session-id",
    }),
  },
}));

// Mock AWS SDK
vi.mock("@aws-sdk/client-device-farm", () => {
  const mockDeviceFarmClient = vi.fn();
  mockDeviceFarmClient.prototype.send = vi.fn();

  // Create mock command constructors that store their input
  const mockCommandConstructors: Record<string, any> = {};
  const createMockCommand = (name: string) => {
    const mockConstructor = vi.fn((input?: any) => {
      const command = { input, constructor: { name } };
      // Add the constructor as a property for instanceof checks
      Object.defineProperty(command, "constructor", {
        value: mockCommandConstructors[name],
        writable: false,
        enumerable: false,
        configurable: true,
      });
      return command;
    });
    mockCommandConstructors[name] = mockConstructor;
    return mockConstructor;
  };

  const commands = {
    CreateUploadCommand: createMockCommand("CreateUploadCommand"),
    GetUploadCommand: createMockCommand("GetUploadCommand"),
    CreateRemoteAccessSessionCommand: createMockCommand(
      "CreateRemoteAccessSessionCommand",
    ),
    GetRemoteAccessSessionCommand: createMockCommand(
      "GetRemoteAccessSessionCommand",
    ),
    StopRemoteAccessSessionCommand: createMockCommand(
      "StopRemoteAccessSessionCommand",
    ),
    ListArtifactsCommand: createMockCommand("ListArtifactsCommand"),
  };

  return {
    DeviceFarmClient: mockDeviceFarmClient,
    ...commands,
  };
});

// Mock fs
vi.mock("fs", () => {
  const mockFs = {
    createReadStream: vi.fn(),
    statSync: vi.fn(),
    existsSync: vi.fn(),
    mkdirSync: vi.fn(),
    createWriteStream: vi.fn(),
    renameSync: vi.fn(),
    unlinkSync: vi.fn(),
    rmSync: vi.fn(),
  };
  return {
    default: mockFs,
    ...mockFs,
  };
});

describe("AWSDeviceFarmProvider", () => {
  let provider: AWSDeviceFarmProvider;
  let mockClient: any;

  beforeEach(() => {
    // Reset all mocks
    vi.clearAllMocks();
    mockFetch.mockReset();

    // Setup mock client with send method
    mockClient = {
      send: vi.fn(),
      destroy: vi.fn(),
    };
    vi.mocked(DeviceFarmClient).mockImplementation(() => mockClient);

    // Default fs mocks - use the default export since that's what the provider uses
    const fsDefault = (fs as any).default || fs;
    vi.mocked(fsDefault.existsSync).mockReturnValue(true);
    vi.mocked(fsDefault.statSync).mockReturnValue({ size: 1024 } as any);
    vi.mocked(fsDefault.createReadStream).mockReturnValue({} as any);
  });

  afterEach(() => {
    vi.clearAllMocks();
    mockFetch.mockReset();
  });

  describe("Constructor & Setup", () => {
    test("validates required fields (projectArn, deviceArn, platform)", () => {
      // Missing projectArn
      expect(() => {
        const project = {
          name: "test-project",
          use: {
            device: {
              deviceArn: "arn:aws:devicefarm:us-west-2::device:123",
            },
            platform: "android",
          },
        };
        new AWSDeviceFarmProvider(project as any, "com.example.app");
      }).toThrow(
        "AWS Device Farm: `projectArn` is required in the device configuration.",
      );

      // Missing deviceArn
      expect(() => {
        const project = {
          name: "test-project",
          use: {
            device: {
              projectArn: "arn:aws:devicefarm:us-west-2:123:project:456",
            },
            platform: "android",
          },
        };
        new AWSDeviceFarmProvider(project as any, "com.example.app");
      }).toThrow(
        "AWS Device Farm: `deviceArn` is required in the device configuration.",
      );

      // Missing platform
      expect(() => {
        const project = {
          name: "test-project",
          use: {
            device: {
              projectArn: "arn:aws:devicefarm:us-west-2:123:project:456",
              deviceArn: "arn:aws:devicefarm:us-west-2::device:123",
            },
          },
        };
        new AWSDeviceFarmProvider(project as any, "com.example.app");
      }).toThrow(
        "AWS Device Farm: `platform` must be specified in the project configuration.",
      );

      // Valid configuration
      expect(() => {
        const project = {
          name: "test-project",
          use: {
            device: {
              projectArn: "arn:aws:devicefarm:us-west-2:123:project:456",
              deviceArn: "arn:aws:devicefarm:us-west-2::device:123",
            },
            platform: "android",
          },
        };
        new AWSDeviceFarmProvider(project as any, "com.example.app");
      }).not.toThrow();
    });

    test("globalSetup uses existing appArn when provided", async () => {
      const project = {
        name: "test-project",
        use: {
          device: {
            projectArn: "arn:aws:devicefarm:us-west-2:123:project:456",
            deviceArn: "arn:aws:devicefarm:us-west-2::device:123",
            appArn: "arn:aws:devicefarm:upload:existing",
          },
          platform: "ios",
        },
      };
      provider = new AWSDeviceFarmProvider(project as any, "com.example.app");

      await provider.globalSetup();

      // Should not create upload or upload file
      expect(mockClient.send).not.toHaveBeenCalled();
      expect(mockFetch).not.toHaveBeenCalled();
    });

    test("uses explicit appArn from config without globalSetup", async () => {
      // This test simulates a runtime provider that doesn't call globalSetup
      const project = {
        name: "test-project",
        use: {
          device: {
            projectArn: "arn:aws:devicefarm:us-west-2:123:project:456",
            deviceArn: "arn:aws:devicefarm:us-west-2::device:123",
            appArn: "arn:aws:devicefarm:upload:explicit-arn",
          },
          platform: "ios",
        },
      };

      provider = new AWSDeviceFarmProvider(project as any, "com.example.app");

      // The provider should have uploadArn set from config even without globalSetup
      expect((provider as any).uploadArn).toBe(
        "arn:aws:devicefarm:upload:explicit-arn",
      );

      // Mock session creation to verify appArn is passed correctly
      mockClient.send
        .mockResolvedValueOnce({
          remoteAccessSession: { arn: "arn:aws:devicefarm:session:123" },
        })
        .mockResolvedValueOnce({
          remoteAccessSession: {
            arn: "arn:aws:devicefarm:session:123",
            status: "RUNNING",
            endpoint: "wss://device.example.com",
            device: { name: "iPhone 14", os: "16.0" },
          },
        });

      // Create remote session without calling globalSetup
      await (provider as any).createRemoteSession();

      // Verify that createRemoteSession used the appArn from config
      const createSessionCall = mockClient.send.mock.calls[0][0];
      expect(createSessionCall.input.appArn).toBe(
        "arn:aws:devicefarm:upload:explicit-arn",
      );
    });

    test("persists upload ARN across provider instances", async () => {
      // Clean up any existing env var
      delete process.env.AWS_DEVICE_FARM_APP_ARN_TEST_PROJECT;

      // First provider instance (simulates globalSetup)
      const project1 = {
        name: "test-project",
        use: {
          device: {
            projectArn: "arn:aws:devicefarm:us-west-2:123:project:456",
            deviceArn: "arn:aws:devicefarm:us-west-2::device:123",
          },
          platform: "android",
          buildPath: "/path/to/app.apk",
        },
      };

      const provider1 = new AWSDeviceFarmProvider(
        project1 as any,
        "com.example.app",
      );

      // Simulate globalSetup storing the ARN
      (provider1 as any).uploadArn = "arn:aws:devicefarm:upload:123";
      process.env.AWS_DEVICE_FARM_APP_ARN_TEST_PROJECT =
        "arn:aws:devicefarm:upload:123";

      // Second provider instance (simulates fixture creation)
      // IMPORTANT: This has the same buildPath as the first instance
      // This is the typical scenario - same config for all instances
      const project2 = {
        name: "test-project",
        use: {
          device: {
            projectArn: "arn:aws:devicefarm:us-west-2:123:project:456",
            deviceArn: "arn:aws:devicefarm:us-west-2::device:123",
          },
          platform: "android",
          buildPath: "/path/to/app.apk", // Same buildPath as first instance
        },
      };

      const provider2 = new AWSDeviceFarmProvider(
        project2 as any,
        "com.example.app",
      );

      // The constructor should have loaded the ARN from env var
      // even though buildPath is provided
      expect((provider2 as any).uploadArn).toBe(
        "arn:aws:devicefarm:upload:123",
      );

      // Mock session creation
      mockClient.send
        .mockResolvedValueOnce({
          remoteAccessSession: { arn: "arn:aws:devicefarm:session:123" },
        })
        .mockResolvedValueOnce({
          remoteAccessSession: {
            arn: "arn:aws:devicefarm:session:123",
            status: "RUNNING",
            endpoint: "wss://device.example.com",
            device: { name: "Pixel 6", os: "12" },
          },
        });

      // Create remote session with second provider
      await (provider2 as any).createRemoteSession();

      // Verify that the second provider used the uploaded ARN from the first provider
      expect(mockClient.send).toHaveBeenCalled();

      // Check that the CreateRemoteAccessSessionCommand was called with the correct appArn
      const createSessionCall = mockClient.send.mock.calls[0][0];
      expect(createSessionCall.input).toBeDefined();
      expect(createSessionCall.input.appArn).toBe(
        "arn:aws:devicefarm:upload:123",
      );

      // Also verify the other expected properties
      expect(createSessionCall.input.projectArn).toBe(
        "arn:aws:devicefarm:us-west-2:123:project:456",
      );
      expect(createSessionCall.input.deviceArn).toBe(
        "arn:aws:devicefarm:us-west-2::device:123",
      );

      // Clean up
      delete process.env.AWS_DEVICE_FARM_APP_ARN_TEST_PROJECT;
    });
  });

  describe("Session Management", () => {
    beforeEach(() => {
      const project = {
        name: "test-project",
        use: {
          device: {
            projectArn: "arn:aws:devicefarm:us-west-2:123:project:456",
            deviceArn: "arn:aws:devicefarm:us-west-2::device:123",
            appArn: "arn:aws:devicefarm:upload:123",
          },
          platform: "android",
          expectTimeout: 30000,
        },
      };
      provider = new AWSDeviceFarmProvider(project as any, "com.example.app");
    });

    test("creates and starts remote session successfully", async () => {
      const mockSession = {
        arn: "arn:aws:devicefarm:session:123",
        status: "RUNNING",
        endpoint: "wss://device.example.com",
        device: {
          name: "Pixel 6",
          os: "12",
        },
      };

      // Mock session creation - returns ARN
      mockClient.send.mockResolvedValueOnce({
        remoteAccessSession: { arn: "arn:aws:devicefarm:session:123" },
      });

      // Mock session status check - returns RUNNING session
      mockClient.send.mockResolvedValueOnce({
        remoteAccessSession: mockSession,
      });

      const session = await (provider as any).createRemoteSession();

      expect(session).toEqual(mockSession);
      expect(mockClient.send).toHaveBeenCalled();
      const createSessionCall = mockClient.send.mock.calls[0][0];
      expect(createSessionCall.input.projectArn).toBe(
        "arn:aws:devicefarm:us-west-2:123:project:456",
      );
      expect(createSessionCall.input.deviceArn).toBe(
        "arn:aws:devicefarm:us-west-2::device:123",
      );
    });

    test("handles query parameters in endpoint correctly", async () => {
      const project = {
        name: "test-project",
        use: {
          device: {
            projectArn: "arn:aws:devicefarm:us-west-2:123:project:456",
            deviceArn: "arn:aws:devicefarm:us-west-2::device:123",
            appArn: "arn:aws:devicefarm:upload:123",
          },
          platform: "android",
          expectTimeout: 30000,
        },
      };
      provider = new AWSDeviceFarmProvider(project as any, "com.example.app");

      // Mock session with query parameters in endpoint
      mockClient.send
        .mockResolvedValueOnce({
          remoteAccessSession: { arn: "arn:aws:devicefarm:session:123" },
        })
        .mockResolvedValueOnce({
          remoteAccessSession: {
            arn: "arn:aws:devicefarm:session:123",
            status: "RUNNING",
            endpoint:
              "wss://device.example.com/wd/hub?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=test&X-Amz-Date=20250101T000000Z&X-Amz-Expires=3600&X-Amz-SignedHeaders=host&X-Amz-Signature=abc123",
            device: { name: "Pixel 6", os: "12" },
          },
        });

      // Mock WebDriver
      const mockWebDriver = (await import("webdriver")).default;
      const mockNewSession = vi.fn().mockResolvedValue({
        sessionId: "mock-session-id",
      });
      vi.mocked(mockWebDriver.newSession).mockImplementation(mockNewSession);

      await provider.getDevice();

      // Verify WebDriver was called with correct connection options
      expect(mockNewSession).toHaveBeenCalledWith(
        expect.objectContaining({
          protocol: "https",
          hostname: "device.example.com",
          port: 443,
          path: "/wd/hub", // Path should NOT include query parameters
          queryParams: {
            "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
            "X-Amz-Credential": "test",
            "X-Amz-Date": "20250101T000000Z",
            "X-Amz-Expires": "3600",
            "X-Amz-SignedHeaders": "host",
            "X-Amz-Signature": "abc123",
          },
        }),
      );
    });

    test("builds correct capabilities for Android/iOS", async () => {
      // Android
      const androidProject = {
        name: "test-project",
        use: {
          device: {
            projectArn: "arn:aws:devicefarm:us-west-2:123:project:456",
            deviceArn: "arn:aws:devicefarm:us-west-2::device:123",
            appArn: "arn:aws:devicefarm:upload:123",
          },
          platform: "android",
        },
      };
      provider = new AWSDeviceFarmProvider(
        androidProject as any,
        "com.example.app",
      );

      const androidCaps = (provider as any).buildCapabilities({
        device: { name: "Pixel 6", os: "12" },
      });

      expect(androidCaps.platformName).toBe("Android");
      expect(androidCaps["appium:automationName"]).toBe("UiAutomator2");
      expect(androidCaps["appium:deviceName"]).toBe("Pixel 6");
      expect(androidCaps["appium:platformVersion"]).toBe("12");
      expect(androidCaps["appium:bundleId"]).toBeUndefined();
      // Should include app capability with the upload ARN
      expect(androidCaps["appium:app"]).toBe("arn:aws:devicefarm:upload:123");

      // iOS
      const iosProject = {
        name: "test-project",
        use: {
          device: {
            projectArn: "arn:aws:devicefarm:us-west-2:123:project:456",
            deviceArn: "arn:aws:devicefarm:us-west-2::device:123",
            appArn: "arn:aws:devicefarm:upload:123",
          },
          platform: "ios",
        },
      };
      provider = new AWSDeviceFarmProvider(
        iosProject as any,
        "com.example.app",
      );

      const iosCaps = (provider as any).buildCapabilities({
        device: { name: "iPhone 14", os: "16.0" },
      });

      expect(iosCaps.platformName).toBe("iOS");
      expect(iosCaps["appium:automationName"]).toBe("XCUITest");
      expect(iosCaps["appium:deviceName"]).toBe("iPhone 14");
      expect(iosCaps["appium:platformVersion"]).toBe("16.0");
      expect(iosCaps["appium:bundleId"]).toBe("com.example.app");
      // Should include app capability with the upload ARN
      expect(iosCaps["appium:app"]).toBe("arn:aws:devicefarm:upload:123");
    });

    test("includes app capability for Android without appPackage/appActivity", async () => {
      // This tests the main bug scenario - user provides buildPath only
      const project = {
        name: "test-project",
        use: {
          device: {
            projectArn: "arn:aws:devicefarm:us-west-2:123:project:456",
            deviceArn: "arn:aws:devicefarm:us-west-2::device:123",
            appArn: "arn:aws:devicefarm:upload:android-app",
            // No appPackage or appActivity provided
          },
          platform: "android",
        },
      };
      provider = new AWSDeviceFarmProvider(project as any, undefined);

      const caps = (provider as any).buildCapabilities({
        device: { name: "Pixel 6", os: "12" },
      });

      // Must include app capability for Appium to work
      expect(caps["appium:app"]).toBe("arn:aws:devicefarm:upload:android-app");
      expect(caps["appium:appPackage"]).toBeUndefined();
      expect(caps["appium:appActivity"]).toBeUndefined();
    });

    test("stops session on cleanup", async () => {
      (provider as any).remoteSessionArn = "arn:aws:devicefarm:session:123";

      mockClient.send.mockResolvedValueOnce({});

      await (provider as any).stopRemoteSession();

      expect(mockClient.send).toHaveBeenCalled();
      const stopSessionCall = mockClient.send.mock.calls[0][0];
      expect(stopSessionCall.input.arn).toBe("arn:aws:devicefarm:session:123");
    });

    test("stops remote session when WebDriver.newSession fails", async () => {
      // Mock successful remote session creation
      mockClient.send
        .mockResolvedValueOnce({
          remoteAccessSession: { arn: "arn:aws:devicefarm:session:123" },
        })
        .mockResolvedValueOnce({
          remoteAccessSession: {
            arn: "arn:aws:devicefarm:session:123",
            status: "RUNNING",
            endpoint: "wss://device.example.com",
            device: { name: "Pixel 6", os: "12" },
          },
        });

      // Mock WebDriver.newSession to fail
      const mockWebDriver = (await import("webdriver")).default;
      vi.mocked(mockWebDriver.newSession).mockRejectedValueOnce(
        new Error("Invalid capabilities: bad automation name"),
      );

      // Mock stopRemoteSession to verify it's called
      mockClient.send.mockResolvedValueOnce({}); // for StopRemoteAccessSessionCommand

      // Attempt to get device should throw
      await expect(provider.getDevice()).rejects.toThrow(
        "Invalid capabilities: bad automation name",
      );

      // Verify that stopRemoteSession was called to clean up
      expect(mockClient.send).toHaveBeenCalledTimes(3); // create, get, stop
      const stopSessionCall = mockClient.send.mock.calls[2][0];
      expect(stopSessionCall.input.arn).toBe("arn:aws:devicefarm:session:123");
    });
  });

  describe("Error Handling", () => {
    test("throws error when both buildPath and appArn missing", async () => {
      const project = {
        name: "test-project",
        use: {
          device: {
            projectArn: "arn:aws:devicefarm:us-west-2:123:project:456",
            deviceArn: "arn:aws:devicefarm:us-west-2::device:123",
          },
          platform: "android",
        },
      };
      provider = new AWSDeviceFarmProvider(project as any, "com.example.app");

      await expect(provider.globalSetup()).rejects.toThrow(
        "AWS Device Farm: Either provide `buildPath` or `appArn` in the configuration.",
      );
    });

    test("handles session creation failure gracefully", async () => {
      const project = {
        name: "test-project",
        use: {
          device: {
            projectArn: "arn:aws:devicefarm:us-west-2:123:project:456",
            deviceArn: "arn:aws:devicefarm:us-west-2::device:123",
            appArn: "arn:aws:devicefarm:upload:123",
          },
          platform: "android",
        },
      };
      provider = new AWSDeviceFarmProvider(project as any, "com.example.app");

      // Mock session creation returns empty response (no ARN)
      mockClient.send.mockResolvedValueOnce({
        remoteAccessSession: {},
      });

      await expect((provider as any).createRemoteSession()).rejects.toThrow(
        "AWS Device Farm: Remote access session ARN was not returned.",
      );
    });

    test("handles upload failure with proper error message", async () => {
      const project = {
        name: "test-project",
        use: {
          device: {
            projectArn: "arn:aws:devicefarm:us-west-2:123:project:456",
            deviceArn: "arn:aws:devicefarm:us-west-2::device:123",
          },
          platform: "android",
          buildPath: "/path/to/app.apk",
        },
      };
      provider = new AWSDeviceFarmProvider(project as any, "com.example.app");

      // Mock upload creation failure
      mockClient.send.mockRejectedValueOnce(
        new Error("Upload creation failed"),
      );

      await expect(provider.globalSetup()).rejects.toThrow(
        "Upload creation failed",
      );
    });
  });

  describe("Video Download", () => {
    test("downloadVideo handles node-fetch v3 stream correctly", async () => {
      const sessionArn = "arn:aws:devicefarm:us-west-2:123:session:456";
      const outputDir = "/tmp/test-output";
      const fileName = "test-video";

      // Mock fs operations
      const fsDefault = (fs as any).default || fs;
      vi.mocked(fsDefault.mkdirSync).mockReturnValue(undefined);
      vi.mocked(fsDefault.existsSync).mockReturnValue(false);

      // Create a mock writable stream
      const mockWriteStream = {};
      vi.mocked(fsDefault.createWriteStream).mockReturnValue(
        mockWriteStream as any,
      );
      vi.mocked(fsDefault.renameSync).mockReturnValue(undefined);

      // Mock client to return video artifact
      mockClient.send.mockResolvedValueOnce({
        artifacts: [
          {
            type: "VIDEO",
            url: "https://presigned-url.example.com/video.mp4",
          },
        ],
      });

      // Mock fetch to return a Node.js Readable stream (node-fetch v3 behavior)
      const { Readable } = await import("stream");
      const mockVideoData = Buffer.from("mock-video-content");
      const mockStream = Readable.from([mockVideoData]);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        body: mockStream, // This is a Node.js Readable, not a Web Stream with getReader()
      } as any);

      // Mock the pipeline function
      const { pipeline } = await import("stream/promises");
      vi.mocked(pipeline).mockResolvedValueOnce(undefined);

      // Call downloadVideo
      const result = await AWSDeviceFarmProvider.downloadVideo(
        sessionArn,
        outputDir,
        fileName,
      );

      // Verify the video was downloaded successfully
      expect(result).toEqual({
        path: "/tmp/test-output/test-video.mp4",
        contentType: "video/mp4",
      });

      // Verify fetch was called with the presigned URL
      expect(mockFetch).toHaveBeenCalledWith(
        "https://presigned-url.example.com/video.mp4",
        expect.objectContaining({ method: "GET" }),
      );

      // Verify the stream was written to the file using pipeline
      expect(fsDefault.createWriteStream).toHaveBeenCalledWith(
        "/tmp/test-output/test-video.mp4.part",
      );

      // Verify pipeline was called with the stream and write stream
      expect(pipeline).toHaveBeenCalledWith(mockStream, mockWriteStream);
    });

    test("downloadVideo returns null when video artifact is not found", async () => {
      const sessionArn = "arn:aws:devicefarm:us-west-2:123:session:456";
      const outputDir = "/tmp/test-output";
      const fileName = "test-video";

      // Mock fs operations
      const fsDefault = (fs as any).default || fs;
      vi.mocked(fsDefault.mkdirSync).mockReturnValue(undefined);

      // Mock client to return no video artifacts
      mockClient.send.mockResolvedValueOnce({
        artifacts: [],
      });

      // Mock async-retry to throw error immediately instead of retrying
      const retry = (await import("async-retry")).default;
      vi.mocked(retry).mockImplementationOnce(async (fn: any) => {
        return await fn(() => {}, 1);
      });

      // Mock logger to suppress error logs during test
      const originalError = logger.error;
      logger.error = vi.fn();

      // Call downloadVideo
      const result = await AWSDeviceFarmProvider.downloadVideo(
        sessionArn,
        outputDir,
        fileName,
      );

      // Restore logger.error
      logger.error = originalError;

      // Should return null when no video found
      expect(result).toBeNull();
    });
  });
});
