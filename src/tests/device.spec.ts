import { describe, test, expect, vi } from "vitest";
//@ts-ignore
import { Client as WebDriverClient } from "webdriver";
import playwrightTest from "@playwright/test";
import { Device } from "../device";
import { Platform, IosPermissionSettings, DeviceProvider } from "../types";
import type { TestInfo } from "@playwright/test";

// Override Playwright's test.step/info to work in Vitest environment
// so boxedStep decorator can execute without throwing.
(playwrightTest as unknown as { step: Function }).step = vi.fn(
  async (_name: string, body: () => Promise<unknown>) => await body(),
);
(playwrightTest as unknown as { info: () => undefined }).info = () => undefined;

const createDevice = (executeScript = vi.fn()) => {
  //@ts-ignore - providing partial WebDriver client for testing
  const webDriverClient: WebDriverClient = {
    executeScript,
  };
  const device = new Device(
    webDriverClient,
    "com.example.app",
    { expectTimeout: 1_000 },
    "emulator",
  );
  return { device, executeScript };
};

const makeTestInfo = (overrides: Partial<TestInfo> = {}): TestInfo => {
  return {
    title: "example test",
    status: "passed",
    errors: [],
    error: undefined,
    testId: "test-id",
    retry: 0,
    workerIndex: 0,
    project: { use: {} },
    ...overrides,
  } as unknown as TestInfo;
};

const createPersistentDevice = () => {
  const { device } = createDevice();
  const syncTestDetails = vi.fn().mockResolvedValue(undefined);
  const provider = {
    getDevice: vi.fn(),
    syncTestDetails,
  } as unknown as DeviceProvider;

  device.attachDeviceProvider(provider);
  device.enablePersistentStatusSync();

  return {
    device,
    syncTestDetails,
    provider,
  };
};

describe("Device", () => {
  describe("backgroundApp", () => {
    test("backgrounds indefinitely by default", async () => {
      const { device, executeScript } = createDevice();
      await device.backgroundApp();
      expect(executeScript).toHaveBeenCalledWith("mobile: backgroundApp", [
        { seconds: -1 },
      ]);
    });

    test("backgrounds for given duration", async () => {
      const { device, executeScript } = createDevice();
      await device.backgroundApp(30);
      expect(executeScript).toHaveBeenCalledWith("mobile: backgroundApp", [
        { seconds: 30 },
      ]);
    });
  });

  describe("iOS App Settings (BrowserStack)", () => {
    describe("updateAppSettings", () => {
      test("formats browserstack_executor correctly for settings bundle", async () => {
        const { device, executeScript } = createDevice();
        vi.spyOn(device, "getPlatform").mockReturnValue(Platform.IOS);
        device["provider"] = "browserstack";

        const settings = {
          DarkMode: 1,
          Environment: "staging",
          "Child Settings": { "Child Setting 1": "abc" },
        };
        await device.updateAppSettings(settings);

        expect(executeScript).toHaveBeenCalledWith(
          expect.stringContaining("browserstack_executor:"),
          [],
        );

        const call = executeScript.mock.calls[0]![0] as string;
        const [, payloadString] = call.split("browserstack_executor: ");
        if (!payloadString) {
          throw new Error(
            "Expected browserstack_executor payload to be present",
          );
        }
        const payload = JSON.parse(payloadString);

        expect(payload).toEqual({
          action: "updateAppSettings",
          arguments: settings,
        });
      });

      test("formats permission settings correctly", async () => {
        const { device, executeScript } = createDevice();
        vi.spyOn(device, "getPlatform").mockReturnValue(Platform.IOS);
        device["provider"] = "browserstack";

        const permissions = {
          "Permission Settings": {
            Location: {
              "ALLOW LOCATION ACCESS": "Always" as const,
              "Precise Location": "ON" as const,
            },
            Camera: "Allow" as const,
          },
        };

        await device.updateAppSettings(permissions);

        const call = executeScript.mock.calls[0]![0] as string;
        const [, payloadString] = call.split("browserstack_executor: ");
        if (!payloadString) {
          throw new Error(
            "Expected browserstack_executor payload to be present",
          );
        }
        const payload = JSON.parse(payloadString);

        expect(payload.arguments).toEqual(permissions);
      });

      test("throws descriptive error for Android platform", async () => {
        const { device } = createDevice();
        vi.spyOn(device, "getPlatform").mockReturnValue(Platform.ANDROID);
        device["provider"] = "browserstack";

        await expect(device.updateAppSettings({})).rejects.toThrow(
          "updateAppSettings is only supported on iOS platform. Current platform: android",
        );
      });

      test("throws descriptive error for non-BrowserStack provider", async () => {
        const { device } = createDevice();
        vi.spyOn(device, "getPlatform").mockReturnValue(Platform.IOS);
        device["provider"] = "emulator";

        await expect(device.updateAppSettings({})).rejects.toThrow(
          /only supported with BrowserStack provider.*Current provider: emulator/,
        );
      });
    });

    describe("updatePermissionSettings", () => {
      test("wraps settings in 'Permission Settings' key", async () => {
        const { device } = createDevice();
        vi.spyOn(device, "getPlatform").mockReturnValue(Platform.IOS);
        device["provider"] = "browserstack";

        const updateSpy = vi.spyOn(device, "updateAppSettings");

        const permissions: IosPermissionSettings = {
          Camera: "Allow",
          Photos: "All Photos",
          Notifications: { "Allow Notifications": "ON" },
        };

        await device.updatePermissionSettings(permissions);

        expect(updateSpy).toHaveBeenCalledWith({
          "Permission Settings": permissions,
        });
      });
    });
  });

  describe("persistent sync", () => {
    test("preparePersistentTest sends name once per test", async () => {
      const { device, syncTestDetails } = createPersistentDevice();
      const info = makeTestInfo({ title: "My test", testId: "t-1" });

      await device.preparePersistentTest(info);
      await device.preparePersistentTest(info);

      expect(syncTestDetails).toHaveBeenCalledTimes(1);
      expect(syncTestDetails).toHaveBeenCalledWith({ name: "My test" });
    });

    test("finalizePersistentTest maps failed status and reason", async () => {
      const { device, syncTestDetails } = createPersistentDevice();
      const info = makeTestInfo({
        title: "fails",
        status: "failed",
        errors: [{ message: "boom" }] as any,
        testId: "t-2",
      });

      await device.finalizePersistentTest(info);

      expect(syncTestDetails).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "fails",
          status: "failed",
          reason: "boom",
        }),
      );
    });

    test("ensurePersistentLifecycle triggers sync for new tests", async () => {
      const { device, syncTestDetails } = createPersistentDevice();
      const first = makeTestInfo({ title: "first", testId: "first", retry: 0 });
      const second = makeTestInfo({
        title: "second",
        testId: "second",
        retry: 0,
      });

      await device.ensurePersistentLifecycle(first);
      await device.ensurePersistentLifecycle(second);

      expect(syncTestDetails).toHaveBeenNthCalledWith(1, { name: "first" });
      expect(syncTestDetails).toHaveBeenNthCalledWith(2, { name: "second" });
    });

    test("finalizePersistentTest defaults skipped to passed without reason", async () => {
      const { device, syncTestDetails } = createPersistentDevice();
      const info = makeTestInfo({
        title: "skipped test",
        status: "skipped",
        testId: "t-3",
      });

      await device.finalizePersistentTest(info);

      expect(syncTestDetails).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "skipped test",
          status: "passed",
        }),
      );
      const payload = syncTestDetails.mock.calls[0]![0];
      expect(payload.reason).toBeUndefined();
    });
  });
});
