import crypto from 'crypto';
import { TestInfo } from '@playwright/test';
import { VisualTraceConfig } from '../types';

export interface VisualTraceState {
  screenshotCount: number;
  dedupeHashes: Set<string>;
}

export class VisualTraceService {
  private states = new Map<string, VisualTraceState>();
  private testInfo: TestInfo;
  private retryIndex: number;
  private config: VisualTraceConfig;

  constructor(testInfo: TestInfo, retryIndex: number, config?: VisualTraceConfig) {
    this.testInfo = testInfo;
    this.retryIndex = retryIndex;

    // Default configuration: only capture on failure
    this.config = {
      enableScreenshots: config?.enableScreenshots ?? 'retain-on-failure',
      maxScreenshots: config?.maxScreenshots ?? 50,
      dedupe: config?.dedupe ?? true,
    };
  }

  /**
   * Get or create state for the current test attempt
   */
  private getState(): VisualTraceState {
    const key = `${this.testInfo.testId}#${this.retryIndex}`;

    if (!this.states.has(key)) {
      this.states.set(key, {
        screenshotCount: 0,
        dedupeHashes: new Set(),
      });
    }

    return this.states.get(key)!;
  }

  /**
   * Check if screenshots should be captured based on trace mode and test status
   */
  shouldCaptureScreenshot(): boolean {
    // Check if screenshots are explicitly disabled
    if (this.config.enableScreenshots === false || this.config.enableScreenshots === 'off') {
      return false;
    }

    // Get trace configuration from Playwright
    const traceMode = this.testInfo.project.use?.trace;

    // If no trace mode is set, use our config
    if (!traceMode) {
      return this.checkConfigMode();
    }

    // Map Playwright trace modes to screenshot behavior
    switch (traceMode) {
      case 'on':
        return true;

      case 'retain-on-failure':
      case 'on-first-retry':
      case 'on-all-retries':
        // These modes should capture when test is failing or in retry
        return this.isTestFailing() || this.retryIndex > 0;

      case 'retry-with-trace':
        return this.retryIndex > 0;

      case 'off':
        return false;

      default:
        return this.checkConfigMode();
    }
  }

  /**
   * Check our own config mode for screenshot capture
   */
  private checkConfigMode(): boolean {
    const mode = this.config.enableScreenshots;

    if (mode === true || mode === 'on') {
      return true;
    }

    if (mode === 'retain-on-failure') {
      return this.isTestFailing();
    }

    return false;
  }

  /**
   * Check if the current test is failing
   */
  private isTestFailing(): boolean {
    // Check test status (will be 'failed', 'timedOut', etc. for failures)
    if (this.testInfo.status && this.testInfo.status !== 'passed') {
      return true;
    }

    // Check if there are any errors
    if (this.testInfo.errors && this.testInfo.errors.length > 0) {
      return true;
    }

    // During test execution, we might not have status yet
    // This will be handled by the retry detection
    return false;
  }

  /**
   * Calculate hash for screenshot deduplication
   */
  private calculateHash(data: Buffer): string {
    return crypto.createHash('sha256').update(data).digest('hex');
  }

  /**
   * Check if we should skip this screenshot due to limits or deduplication
   */
  private shouldSkipScreenshot(data?: Buffer): boolean {
    const state = this.getState();

    // Check max screenshot limit
    if (this.config.maxScreenshots && state.screenshotCount >= this.config.maxScreenshots) {
      return true;
    }

    // Check deduplication if enabled and data provided
    if (this.config.dedupe && data) {
      const hash = this.calculateHash(data);
      if (state.dedupeHashes.has(hash)) {
        return true;
      }
      state.dedupeHashes.add(hash);
    }

    return false;
  }

  /**
   * Capture and attach a screenshot to the test
   */
  async captureScreenshot(
    takeScreenshot: () => Promise<Buffer>,
    stepTitle?: string
  ): Promise<void> {
    // Check if we should capture screenshots
    if (!this.shouldCaptureScreenshot()) {
      return;
    }

    try {
      // Take the screenshot
      const screenshotData = await takeScreenshot();

      // Check if we should skip this screenshot
      if (this.shouldSkipScreenshot(screenshotData)) {
        return;
      }

      // Update state
      const state = this.getState();
      state.screenshotCount++;

      // Generate filename with step title if provided
      const timestamp = Date.now();
      const stepSuffix = stepTitle ? `-${stepTitle.replace(/[^a-zA-Z0-9]/g, '_')}` : '';
      const filename = `screenshot-${timestamp}${stepSuffix}.png`;

      // Attach to test
      await this.testInfo.attach(filename, {
        body: screenshotData,
        contentType: 'image/png',
      });
    } catch (error) {
      // Log error but don't fail the test
      console.warn(`Failed to capture screenshot: ${error}`);
    }
  }

  /**
   * Reset state for a test (useful for cleanup)
   */
  resetState(): void {
    const key = `${this.testInfo.testId}#${this.retryIndex}`;
    this.states.delete(key);
  }

  /**
   * Get current screenshot count for the test
   */
  getScreenshotCount(): number {
    const state = this.getState();
    return state.screenshotCount;
  }

  /**
   * Update configuration at runtime
   */
  updateConfig(config: Partial<VisualTraceConfig>): void {
    this.config = { ...this.config, ...config };
  }
}

// Singleton instance management
let serviceInstance: VisualTraceService | null = null;

/**
 * Initialize the Visual Trace Service for a test
 */
export function initializeVisualTrace(
  testInfo: TestInfo,
  retryIndex: number,
  config?: VisualTraceConfig
): VisualTraceService {
  serviceInstance = new VisualTraceService(testInfo, retryIndex, config);
  return serviceInstance;
}

/**
 * Get the current Visual Trace Service instance
 */
export function getVisualTraceService(): VisualTraceService | null {
  return serviceInstance;
}

/**
 * Clear the Visual Trace Service instance
 */
export function clearVisualTraceService(): void {
  if (serviceInstance) {
    serviceInstance.resetState();
    serviceInstance = null;
  }
}