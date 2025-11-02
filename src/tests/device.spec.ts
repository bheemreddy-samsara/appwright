import { describe, test, expect, vi } from "vitest";
//@ts-ignore
import type { Client as WebDriverClient } from "webdriver";
import playwrightTest from "@playwright/test";
import { Device } from "../device";

// Override Playwright's test.step/info to work in Vitest environment
// so boxedStep decorator can execute without throwing.
(playwrightTest as unknown as { step: Function }).step = vi
  .fn(async (_name: string, body: () => Promise<unknown>) => await body());
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

describe("Device.backgroundApp", () => {
  test("backgrounds indefinitely by default", async () => {
    const { device, executeScript } = createDevice();
    await device.backgroundApp();
    expect(executeScript).toHaveBeenCalledWith("mobile: backgroundApp", [-1]);
  });

  test("backgrounds for given duration", async () => {
    const { device, executeScript } = createDevice();
    await device.backgroundApp(30);
    expect(executeScript).toHaveBeenCalledWith("mobile: backgroundApp", [
      30,
    ]);
  });
});
