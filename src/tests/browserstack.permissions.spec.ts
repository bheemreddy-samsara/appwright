import { describe, afterEach, expect, test } from "vitest";
import { BrowserStackDeviceProvider } from "../providers/browserstack";
import { Platform, type BrowserStackConfig } from "../types";
import type { FullProject } from "@playwright/test";

const makeEnvKey = (projectName: string) =>
  `BROWSERSTACK_APP_URL_${projectName.toUpperCase()}`;

const baseDevice: BrowserStackConfig = {
  provider: "browserstack",
  name: "Test Device",
  osVersion: "14",
};

const makeProvider = (
  platform: Platform,
  deviceOverrides: Partial<BrowserStackConfig> = {},
) => {
  const projectName = "mobile";
  const project = {
    name: projectName,
    use: {
      buildPath: "bs://app-url",
      platform,
      expectTimeout: 5_000,
      device: {
        ...baseDevice,
        ...deviceOverrides,
      },
    },
  } as unknown as FullProject<any>;

  const provider = new BrowserStackDeviceProvider(project, undefined);
  process.env[makeEnvKey(projectName)] = "bs://app-url";
  return { provider, projectName };
};

afterEach(() => {
  delete process.env.BROWSERSTACK_USERNAME;
  delete process.env.BROWSERSTACK_ACCESS_KEY;
  Object.keys(process.env)
    .filter((key) => key.startsWith("BROWSERSTACK_APP_URL_"))
    .forEach((key) => delete process.env[key]);
});

describe("BrowserStack permission prompt capabilities", () => {
  test("android defaults to auto-granting permissions", () => {
    const { provider } = makeProvider(Platform.ANDROID);
    const config = (provider as any).createConfig();
    expect(config.capabilities["appium:autoGrantPermissions"]).toBe(true);
  });

  test("android manual mode omits autoGrantPermissions capability", () => {
    const { provider } = makeProvider(Platform.ANDROID, {
      permissionPrompts: { android: { grantPermissions: "manual" } },
    });
    const config = (provider as any).createConfig();
    expect(config.capabilities).not.toHaveProperty(
      "appium:autoGrantPermissions",
    );
  });

  test("ios defaults to accepting alerts below iOS 13", () => {
    const { provider } = makeProvider(Platform.IOS, {
      osVersion: "12.4",
    });
    const config = (provider as any).createConfig();
    expect(config.capabilities["appium:autoAcceptAlerts"]).toBe(true);
    expect(config.capabilities["appium:autoDismissAlerts"]).toBeUndefined();
  });

  test("ios defaults to accepting alerts on iOS 13+ using flipped capability", () => {
    const { provider } = makeProvider(Platform.IOS, {
      osVersion: "14.0",
    });
    const config = (provider as any).createConfig();
    expect(config.capabilities["appium:autoDismissAlerts"]).toBe(true);
    expect(config.capabilities["appium:autoAcceptAlerts"]).toBeUndefined();
  });

  test("ios manual mode omits alert capabilities", () => {
    const { provider } = makeProvider(Platform.IOS, {
      osVersion: "15",
      permissionPrompts: { ios: { behavior: "manual" } },
    });
    const config = (provider as any).createConfig();
    expect(config.capabilities).not.toHaveProperty("appium:autoAcceptAlerts");
    expect(config.capabilities).not.toHaveProperty("appium:autoDismissAlerts");
  });

  test("ios dismiss behavior sets appropriate capability", () => {
    const { provider } = makeProvider(Platform.IOS, {
      osVersion: "12.0",
      permissionPrompts: { ios: { behavior: "dismiss" } },
    });
    const config = (provider as any).createConfig();
    expect(config.capabilities["appium:autoDismissAlerts"]).toBe(true);
    expect(config.capabilities["appium:autoAcceptAlerts"]).toBeUndefined();
  });

  test("ios dismiss on 13+ flips to autoAcceptAlerts capability", () => {
    const { provider } = makeProvider(Platform.IOS, {
      osVersion: "16.0",
      permissionPrompts: { ios: { behavior: "dismiss" } },
    });
    const config = (provider as any).createConfig();
    expect(config.capabilities["appium:autoAcceptAlerts"]).toBe(true);
    expect(config.capabilities["appium:autoDismissAlerts"]).toBeUndefined();
  });
});
