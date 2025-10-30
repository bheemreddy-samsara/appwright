import test, { TestInfo } from "@playwright/test";
import fs from "fs";
import path from "path";
import { getVisualTraceService } from "./visualTrace";

export function boxedStep(
  target: Function,
  context: ClassMethodDecoratorContext,
) {
  return function replacementMethod(
    this: {
      selector?: string | RegExp;
      device?: {
        takeScreenshot: () => Promise<Buffer>;
        initializeVisualTrace?: (
          testInfo: any,
          retryIndex: number,
          config?: any,
        ) => void;
      };
      takeScreenshot?: () => Promise<Buffer>;
      initializeVisualTrace?: (
        testInfo: any,
        retryIndex: number,
        config?: any,
      ) => void;
    },
    ...args: any
  ) {
    const path = this.selector ? `("${this.selector}")` : "";
    const argsString = args.length
      ? "(" +
        Array.from(args)
          .map((a) => JSON.stringify(a))
          .join(" , ") +
        ")"
      : "";
    const name = `${context.name as string}${path}${argsString}`;
    return test.step(
      name,
      async () => {
        let result;
        let stepFailed = false;
        try {
          result = await target.call(this, ...args);
        } catch (error) {
          stepFailed = true;
          throw error; // Re-throw to preserve test failure
        } finally {
          // Capture screenshot even if step throws an error
          let visualTrace = getVisualTraceService();

          // If Visual Trace is not initialized (e.g., for persistentDevice),
          // initialize it lazily using current test info
          if (!visualTrace && test.info) {
            try {
              const testInfo = test.info();
              const device = this.device || this;
              if (device?.initializeVisualTrace && testInfo) {
                // Get visual trace config from project
                const visualTraceConfig = (testInfo.project as any)?.use
                  ?.visualTrace;
                device.initializeVisualTrace(
                  testInfo,
                  testInfo.retry,
                  visualTraceConfig,
                );
                visualTrace = getVisualTraceService();
              }
            } catch (e) {
              // test.info() might not be available in some contexts
            }
          }

          // For Device methods, 'this' is the Device instance
          // For Locator methods, 'this.device' is the Device instance
          const takeScreenshot =
            this.device?.takeScreenshot || this.takeScreenshot;
          if (visualTrace && takeScreenshot) {
            await visualTrace.captureScreenshot(
              () => takeScreenshot.call(this.device || this),
              context.name as string,
              stepFailed,
            );
          }
        }
        return result;
      },
      { box: true },
    );
  };
}

export function validateBuildPath(
  buildPath: string | undefined,
  expectedExtension: string,
) {
  if (!buildPath) {
    throw new Error(
      `Build path not found. Please set the build path in appwright.config.ts`,
    );
  }

  if (!buildPath.endsWith(expectedExtension)) {
    throw new Error(
      `File path is not supported for the given combination of platform and provider. Please provide build with ${expectedExtension} file extension in the appwright.config.ts`,
    );
  }

  if (!fs.existsSync(buildPath)) {
    throw new Error(
      `File not found at given path: ${buildPath}
Please provide the correct path of the build.`,
    );
  }
}

export function getLatestBuildToolsVersions(
  versions: string[],
): string | undefined {
  return versions.sort((a, b) => (a > b ? -1 : 1))[0];
}

export function longestDeterministicGroup(pattern: RegExp): string | undefined {
  const patternToString = pattern.toString();
  const matches = [...patternToString.matchAll(/\(([^)]+)\)/g)].map(
    (match) => match[1],
  );
  if (!matches || !matches.length) {
    return undefined;
  }
  const noSpecialChars: string[] = matches.filter((match): match is string => {
    if (!match) {
      return false;
    }
    const regexSpecialCharsPattern = /[.*+?^${}()|[\]\\]/;
    return !regexSpecialCharsPattern.test(match);
  });
  const longestString = noSpecialChars.reduce(
    (max, str) => (str.length > max.length ? str : max),
    "",
  );
  if (longestString == "") {
    return undefined;
  }
  return longestString;
}

export function basePath() {
  return path.join(process.cwd(), "playwright-report", "data", "videos-store");
}

/**
 * Check if tracing is enabled for the current test based on Playwright's trace configuration
 */
export function isTracingEnabled(
  testInfo: TestInfo,
  retryIndex: number,
): boolean {
  const traceMode = testInfo.project.use?.trace;

  if (!traceMode || traceMode === "off") {
    return false;
  }

  if (traceMode === "on") {
    return true;
  }

  if (traceMode === "retain-on-failure") {
    // Tracing is enabled if the test has failed
    return testInfo.status !== undefined && testInfo.status !== "passed";
  }

  if (traceMode === "on-first-retry") {
    // Tracing is enabled on the first retry only
    return retryIndex === 1;
  }

  if (traceMode === "on-all-retries" || traceMode === "retry-with-trace") {
    // Tracing is enabled on all retries
    return retryIndex > 0;
  }

  return false;
}

/**
 * Determine if screenshots should be captured based on trace mode
 */
export function shouldCaptureScreenshotsFromTrace(
  testInfo: TestInfo,
  retryIndex: number,
): boolean {
  // Check if screenshots are explicitly disabled in project config
  const screenshotsConfig = testInfo.project.use?.screenshot;
  if (screenshotsConfig === "off") {
    return false;
  }

  // Use trace configuration to determine screenshot behavior
  return isTracingEnabled(testInfo, retryIndex);
}
