import { test as base, FullProject } from "@playwright/test";

import {
  AppwrightLocator,
  DeviceProvider,
  ActionOptions,
  AppwrightConfig,
  VisualTraceConfig,
  Platform,
  BrowserStackConfig,
  IosAppSettings,
} from "../types";
import { Device } from "../device";
import { createDeviceProvider } from "../providers";
import { WorkerInfoStore } from "./workerInfo";
import { stopAppiumServer } from "../providers/appium";
import { logger } from "../logger";

type PersistentDeviceContext = {
  device: Device;
  activeOperations: number;
  idlePromise?: Promise<void>;
  resolveIdle?: () => void;
};

const persistentDevicesByWorker = new Map<number, PersistentDeviceContext>();

async function applyIosAppSettings(
  project: FullProject<AppwrightConfig>,
  device: Device,
): Promise<void> {
  if (project.use.platform !== Platform.IOS) {
    return;
  }

  const deviceConfig = project.use.device;
  if (!deviceConfig || deviceConfig.provider !== "browserstack") {
    return;
  }

  const browserStackConfig = deviceConfig as BrowserStackConfig;

  const envSettingsJson = process.env.APPWRIGHT_BS_UPDATE_APP_SETTINGS_JSON;
  let settings: IosAppSettings | undefined;

  if (envSettingsJson) {
    try {
      settings = JSON.parse(envSettingsJson) as IosAppSettings;
    } catch (error) {
      throw new Error(
        "APPWRIGHT_BS_UPDATE_APP_SETTINGS_JSON is not valid JSON. Provide a valid JSON string.",
      );
    }
  } else {
    settings = browserStackConfig.updateAppSettings;
  }

  if (!settings || typeof settings !== "object") {
    return;
  }

  try {
    await device.updateAppSettings(settings);

    const hasPermissions = Object.prototype.hasOwnProperty.call(
      settings,
      "Permission Settings",
    );
    const customKeys = Object.keys(settings).filter(
      (key) => key !== "Permission Settings",
    );
    if (hasPermissions || customKeys.length > 0) {
      logger.log(
        `iOS app settings applied before tests: permissions=${hasPermissions}, custom_keys=${customKeys.length}`,
      );
    }
  } catch (error) {
    logger.warn("Failed to apply iOS app settings in fixture", error);
  }
}

function createPersistentContext(device: Device): PersistentDeviceContext {
  return {
    device,
    activeOperations: 0,
  };
}

async function runWithLifecycle(
  context: PersistentDeviceContext,
  task: () => Promise<void>,
): Promise<void> {
  context.activeOperations += 1;
  try {
    await task();
  } finally {
    context.activeOperations -= 1;
    if (context.activeOperations === 0 && context.resolveIdle) {
      context.resolveIdle();
      context.resolveIdle = undefined;
      context.idlePromise = undefined;
    }
  }
}

async function waitForLifecycleToComplete(
  context: PersistentDeviceContext,
): Promise<void> {
  if (context.activeOperations === 0) {
    return;
  }
  if (!context.idlePromise) {
    context.idlePromise = new Promise<void>((resolve) => {
      context.resolveIdle = resolve;
    });
  }
  await context.idlePromise;
}

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

    await applyIosAppSettings(
      testInfo.project as FullProject<AppwrightConfig>,
      device,
    );

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

      await applyIosAppSettings(
        project as FullProject<AppwrightConfig>,
        device,
      );

      const context = createPersistentContext(device);
      persistentDevicesByWorker.set(workerIndex, context);
      try {
        await use(device);
      } finally {
        await waitForLifecycleToComplete(context);
        persistentDevicesByWorker.delete(workerIndex);
        await workerInfoStore.saveWorkerEndTime(workerIndex, new Date());
        await device.close();
      }
    },
    { scope: "worker" },
  ],
});

test.beforeEach(async ({}, testInfo) => {
  const context = persistentDevicesByWorker.get(testInfo.workerIndex);
  if (!context) {
    return;
  }
  await runWithLifecycle(context, async () => {
    try {
      await context.device.preparePersistentTest(testInfo);
    } catch (error) {
      logger.warn("Failed to prepare persistent test", error);
    }
  });
});

test.afterEach(async ({}, testInfo) => {
  const context = persistentDevicesByWorker.get(testInfo.workerIndex);
  if (!context) {
    return;
  }
  await runWithLifecycle(context, async () => {
    try {
      await context.device.finalizePersistentTest(testInfo);
    } catch (error) {
      logger.warn("Failed to finalize persistent test", error);
    }
  });
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
