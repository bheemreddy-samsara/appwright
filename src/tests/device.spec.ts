import { describe, test, expect, vi } from "vitest";
//@ts-ignore
import { Client as WebDriverClient } from "webdriver";
import playwrightTest from "@playwright/test";
import { Device } from "../device";
import { Platform, IosPermissionSettings } from "../types";

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
});
