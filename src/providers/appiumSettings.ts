import { AppiumSettings, Platform } from "../types";

type AppiumCapabilities = Record<string, unknown>;

type AppiumSettingsOptions = {
  includeBrowserStackSettings?: boolean;
  includeUpdateSettingsCapabilities?: boolean;
};

export function buildAppiumUpdateSettings(
  appiumSettings: AppiumSettings | undefined,
  platformName: Platform | undefined,
) {
  if (!appiumSettings) {
    return undefined;
  }

  const settings: Record<string, unknown> = {};
  const includeAndroidSettings =
    platformName === Platform.ANDROID || platformName === undefined;
  const includeIosSettings =
    platformName === Platform.IOS || platformName === undefined;

  if (includeAndroidSettings) {
    if (appiumSettings.snapshotMaxDepth !== undefined) {
      settings.snapshotMaxDepth = appiumSettings.snapshotMaxDepth;
    }
    if (appiumSettings.waitForIdleTimeout !== undefined) {
      settings.waitForIdleTimeout = appiumSettings.waitForIdleTimeout;
    }
    if (appiumSettings.waitForSelectorTimeout !== undefined) {
      settings.waitForSelectorTimeout = appiumSettings.waitForSelectorTimeout;
    }
    if (appiumSettings.actionAcknowledgmentTimeout !== undefined) {
      settings.actionAcknowledgmentTimeout =
        appiumSettings.actionAcknowledgmentTimeout;
    }
    if (appiumSettings.ignoreUnimportantViews !== undefined) {
      settings.ignoreUnimportantViews = appiumSettings.ignoreUnimportantViews;
    }
    if (appiumSettings.customSnapshotTimeout !== undefined) {
      settings.customSnapshotTimeout = appiumSettings.customSnapshotTimeout;
    }
  }

  if (includeIosSettings) {
    if (appiumSettings.snapshotTimeout !== undefined) {
      settings.snapshotTimeout = appiumSettings.snapshotTimeout;
    }
    if (appiumSettings.waitForQuiescence !== undefined) {
      settings.shouldWaitForQuiescence = appiumSettings.waitForQuiescence;
    }
  }

  return Object.keys(settings).length > 0 ? settings : undefined;
}

export function applyAppiumSettingsToCapabilities(
  capabilities: AppiumCapabilities,
  appiumSettings: AppiumSettings | undefined,
  platformName: Platform | undefined,
  options: AppiumSettingsOptions = {},
) {
  if (!appiumSettings) {
    return;
  }
  const includeUpdateSettingsCapabilities =
    options.includeUpdateSettingsCapabilities !== false;

  if (includeUpdateSettingsCapabilities && platformName === Platform.ANDROID) {
    if (appiumSettings.snapshotMaxDepth !== undefined) {
      capabilities["appium:settings[snapshotMaxDepth]"] =
        appiumSettings.snapshotMaxDepth;
    }
  }

  if (appiumSettings.newCommandTimeout !== undefined) {
    capabilities["appium:newCommandTimeout"] = appiumSettings.newCommandTimeout;
  }

  if (platformName === Platform.ANDROID) {
    if (includeUpdateSettingsCapabilities) {
      if (appiumSettings.waitForIdleTimeout !== undefined) {
        capabilities["appium:settings[waitForIdleTimeout]"] =
          appiumSettings.waitForIdleTimeout;
      }
      if (appiumSettings.waitForSelectorTimeout !== undefined) {
        capabilities["appium:settings[waitForSelectorTimeout]"] =
          appiumSettings.waitForSelectorTimeout;
      }
      if (appiumSettings.actionAcknowledgmentTimeout !== undefined) {
        capabilities["appium:settings[actionAcknowledgmentTimeout]"] =
          appiumSettings.actionAcknowledgmentTimeout;
      }
      if (appiumSettings.ignoreUnimportantViews !== undefined) {
        capabilities["appium:settings[ignoreUnimportantViews]"] =
          appiumSettings.ignoreUnimportantViews;
      }
      if (appiumSettings.customSnapshotTimeout !== undefined) {
        capabilities["appium:settings[customSnapshotTimeout]"] =
          appiumSettings.customSnapshotTimeout;
      }
    }
    if (appiumSettings.disableWindowAnimation !== undefined) {
      capabilities["appium:disableWindowAnimation"] =
        appiumSettings.disableWindowAnimation;
    }
    if (appiumSettings.skipDeviceInitialization !== undefined) {
      capabilities["appium:skipDeviceInitialization"] =
        appiumSettings.skipDeviceInitialization;
    }
    if (appiumSettings.chromedriverAutodownload !== undefined) {
      capabilities["appium:chromedriverAutodownload"] =
        appiumSettings.chromedriverAutodownload;
    }
  }

  if (platformName === Platform.IOS) {
    if (includeUpdateSettingsCapabilities) {
      if (appiumSettings.waitForQuiescence !== undefined) {
        capabilities["appium:settings[shouldWaitForQuiescence]"] =
          appiumSettings.waitForQuiescence;
      }
    }
    if (appiumSettings.animationCoolOffTimeout !== undefined) {
      capabilities["appium:animationCoolOffTimeout"] =
        appiumSettings.animationCoolOffTimeout;
    }
    if (appiumSettings.reduceMotion !== undefined) {
      capabilities["appium:reduceMotion"] = appiumSettings.reduceMotion;
    }
    if (includeUpdateSettingsCapabilities) {
      if (appiumSettings.snapshotTimeout !== undefined) {
        capabilities["appium:settings[snapshotTimeout]"] =
          appiumSettings.snapshotTimeout;
      }
    }
    if (appiumSettings.includeSafariInWebviews !== undefined) {
      capabilities["appium:includeSafariInWebviews"] =
        appiumSettings.includeSafariInWebviews;
    }
  }

  if (options.includeBrowserStackSettings && appiumSettings.bstackPageSource) {
    capabilities["appium:bstackPageSource"] = appiumSettings.bstackPageSource;
  }
}
