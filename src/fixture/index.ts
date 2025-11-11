import { test as base, FullProject } from "@playwright/test";

import {
  AppwrightLocator,
  DeviceProvider,
  ActionOptions,
  AppwrightConfig,
  VisualTraceConfig,
} from "../types";
import { Device } from "../device";
import { createDeviceProvider } from "../providers";
import { WorkerInfoStore } from "./workerInfo";
import { stopAppiumServer } from "../providers/appium";

const persistentDevicesByWorker = new Map<number, Device>();

type TestLevelFixtures = {
  /**
   * Device provider to be used for the test.
   * This creates and manages the device lifecycle for the test
   */
  deviceProvider: DeviceProvider;

  /**
   * The device instance that will be used for running the test.
   * This provides the functionality to interact with the device
   * during the test.
   */
  device: Device;
};

type WorkerLevelFixtures = {
  persistentDevice: Device;
};

export const test = base.extend<TestLevelFixtures, WorkerLevelFixtures>({
  deviceProvider: async ({}, use, testInfo) => {
    const deviceProvider = createDeviceProvider(testInfo.project);
    await use(deviceProvider);
  },
  device: async ({ deviceProvider }, use, testInfo) => {
    const device = await deviceProvider.getDevice();
    const deviceProviderName = (
      testInfo.project as FullProject<AppwrightConfig>
    ).use.device?.provider;
    testInfo.annotations.push({
      type: "providerName",
      description: deviceProviderName,
    });
    testInfo.annotations.push({
      type: "sessionId",
      description: deviceProvider.sessionId,
    });

    // Initialize Visual Trace Service for screenshot capture
    const visualTraceConfig = (
      testInfo.project as FullProject<
        AppwrightConfig & { visualTrace?: VisualTraceConfig }
      >
    ).use.visualTrace;
    device.initializeVisualTrace(testInfo, testInfo.retry, visualTraceConfig);

    await deviceProvider.syncTestDetails?.({ name: testInfo.title });
    await use(device);
    await device.close();
    if (
      deviceProviderName === "emulator" ||
      deviceProviderName === "local-device"
    ) {
      await stopAppiumServer();
    }
    await deviceProvider.syncTestDetails?.({
      name: testInfo.title,
      status: testInfo.status,
      reason: testInfo.error?.message,
    });
  },
  persistentDevice: [
    async ({}, use, workerInfo) => {
      const { project, workerIndex } = workerInfo;
      const beforeSession = new Date();
      const deviceProvider = createDeviceProvider(project);
      const device = await deviceProvider.getDevice();
      const sessionId = deviceProvider.sessionId;
      if (!sessionId) {
        throw new Error("Worker must have a sessionId.");
      }
      const providerName = (project as FullProject<AppwrightConfig>).use.device
        ?.provider;

      // Note: For persistentDevice, Visual Trace is initialized lazily in boxedStep
      // when test.info() is available, ensuring it works for worker-scoped fixtures.

      const afterSession = new Date();
      const workerInfoStore = new WorkerInfoStore();
      await workerInfoStore.saveWorkerStartTime(
        workerIndex,
        sessionId,
        providerName!,
        beforeSession,
        afterSession,
      );
      device.attachDeviceProvider(deviceProvider);
      device.enablePersistentStatusSync();
      persistentDevicesByWorker.set(workerIndex, device);
      try {
        await use(device);
      } finally {
        persistentDevicesByWorker.delete(workerIndex);
        await workerInfoStore.saveWorkerEndTime(workerIndex, new Date());
        await device.close();
      }
    },
    { scope: "worker" },
  ],
});

test.beforeEach(async ({}, testInfo) => {
  const device = persistentDevicesByWorker.get(testInfo.workerIndex);
  if (!device) {
    return;
  }
  await device.preparePersistentTest(testInfo);
});

test.afterEach(async ({}, testInfo) => {
  const device = persistentDevicesByWorker.get(testInfo.workerIndex);
  if (!device) {
    return;
  }
  await device.finalizePersistentTest(testInfo);
});

/**
 * Function to extend Playwright’s expect assertion capabilities.
 * This adds a new method `toBeVisible` which checks if an element is visible on the screen.
 *
 * @param locator The AppwrightLocator that locates the element on the device screen.
 * @param options
 * @returns
 */
export const expect = test.expect.extend({
  toBeVisible: async (locator: AppwrightLocator, options?: ActionOptions) => {
    const isVisible = await locator.isVisible(options);
    return {
      message: () => (isVisible ? "" : `Element was not found on the screen`),
      pass: isVisible,
      name: "toBeVisible",
      expected: true,
      actual: isVisible,
    };
  },
});
