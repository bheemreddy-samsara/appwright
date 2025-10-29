import { test, expect, TestInfo } from '@playwright/test';
import {
  VisualTraceService,
  initializeVisualTrace,
  getVisualTraceService,
  clearVisualTraceService,
} from '../visualTrace/service';
import { VisualTraceConfig } from '../types';

// Mock TestInfo object
function createMockTestInfo(options: {
  testId?: string;
  retry?: number;
  status?: 'passed' | 'failed' | 'timedOut';
  errors?: Error[];
  trace?: string;
  screenshots?: boolean | string;
}): TestInfo {
  return {
    testId: options.testId || 'test-1',
    retry: options.retry || 0,
    status: options.status,
    errors: options.errors || [],
    project: {
      use: {
        trace: options.trace,
        screenshots: options.screenshots,
      },
    },
    attach: jest.fn(),
  } as unknown as TestInfo;
}

// Mock screenshot function
const mockTakeScreenshot = jest.fn(() => Promise.resolve(Buffer.from('mock-screenshot-data')));

describe('VisualTraceService', () => {
  beforeEach(() => {
    clearVisualTraceService();
    mockTakeScreenshot.mockClear();
  });

  describe('Configuration', () => {
    test('should use default configuration when no config provided', () => {
      const testInfo = createMockTestInfo({ testId: 'test-1' });
      const service = new VisualTraceService(testInfo, 0);

      expect(service['config']).toEqual({
        enableScreenshots: 'retain-on-failure',
        maxScreenshots: 50,
        dedupe: true,
      });
    });

    test('should merge provided config with defaults', () => {
      const testInfo = createMockTestInfo({ testId: 'test-1' });
      const config: VisualTraceConfig = {
        enableScreenshots: 'on',
        maxScreenshots: 10,
      };
      const service = new VisualTraceService(testInfo, 0, config);

      expect(service['config']).toEqual({
        enableScreenshots: 'on',
        maxScreenshots: 10,
        dedupe: true, // Default value
      });
    });
  });

  describe('shouldCaptureScreenshot', () => {
    test('should return true when trace mode is "on"', () => {
      const testInfo = createMockTestInfo({ trace: 'on' });
      const service = new VisualTraceService(testInfo, 0);

      expect(service.shouldCaptureScreenshot()).toBe(true);
    });

    test('should return false when trace mode is "off"', () => {
      const testInfo = createMockTestInfo({ trace: 'off' });
      const service = new VisualTraceService(testInfo, 0);

      expect(service.shouldCaptureScreenshot()).toBe(false);
    });

    test('should return false when screenshots are explicitly disabled', () => {
      const testInfo = createMockTestInfo({ trace: 'on' });
      const service = new VisualTraceService(testInfo, 0, { enableScreenshots: false });

      expect(service.shouldCaptureScreenshot()).toBe(false);
    });

    test('should return true for failed test with "retain-on-failure"', () => {
      const testInfo = createMockTestInfo({
        trace: 'retain-on-failure',
        status: 'failed'
      });
      const service = new VisualTraceService(testInfo, 0);

      expect(service.shouldCaptureScreenshot()).toBe(true);
    });

    test('should return false for passed test with "retain-on-failure"', () => {
      const testInfo = createMockTestInfo({
        trace: 'retain-on-failure',
        status: 'passed'
      });
      const service = new VisualTraceService(testInfo, 0);

      expect(service.shouldCaptureScreenshot()).toBe(false);
    });

    test('should return true on retry with "on-first-retry"', () => {
      const testInfo = createMockTestInfo({ trace: 'on-first-retry' });
      const service = new VisualTraceService(testInfo, 1);

      expect(service.shouldCaptureScreenshot()).toBe(true);
    });

    test('should return false on initial run with "on-first-retry"', () => {
      const testInfo = createMockTestInfo({ trace: 'on-first-retry' });
      const service = new VisualTraceService(testInfo, 0);

      expect(service.shouldCaptureScreenshot()).toBe(false);
    });

    test('should return true on all retries with "on-all-retries"', () => {
      const testInfo = createMockTestInfo({ trace: 'on-all-retries' });
      const service1 = new VisualTraceService(testInfo, 1);
      const service2 = new VisualTraceService(testInfo, 2);

      expect(service1.shouldCaptureScreenshot()).toBe(true);
      expect(service2.shouldCaptureScreenshot()).toBe(true);
    });

    test('should return true when test has errors', () => {
      const testInfo = createMockTestInfo({
        trace: 'retain-on-failure',
        errors: [new Error('Test failed')]
      });
      const service = new VisualTraceService(testInfo, 0);

      expect(service.shouldCaptureScreenshot()).toBe(true);
    });
  });

  describe('captureScreenshot', () => {
    test('should capture screenshot when conditions are met', async () => {
      const testInfo = createMockTestInfo({ trace: 'on' });
      const service = new VisualTraceService(testInfo, 0);

      await service.captureScreenshot(mockTakeScreenshot, 'test-step');

      expect(mockTakeScreenshot).toHaveBeenCalled();
      expect(testInfo.attach).toHaveBeenCalledWith(
        expect.stringContaining('screenshot-'),
        expect.objectContaining({
          body: expect.any(Buffer),
          contentType: 'image/png',
        })
      );
    });

    test('should not capture screenshot when disabled', async () => {
      const testInfo = createMockTestInfo({ trace: 'off' });
      const service = new VisualTraceService(testInfo, 0);

      await service.captureScreenshot(mockTakeScreenshot, 'test-step');

      expect(mockTakeScreenshot).not.toHaveBeenCalled();
      expect(testInfo.attach).not.toHaveBeenCalled();
    });

    test('should include step title in filename', async () => {
      const testInfo = createMockTestInfo({ trace: 'on' });
      const service = new VisualTraceService(testInfo, 0);

      await service.captureScreenshot(mockTakeScreenshot, 'click-submit');

      expect(testInfo.attach).toHaveBeenCalledWith(
        expect.stringContaining('click_submit'),
        expect.any(Object)
      );
    });

    test('should handle screenshot capture errors gracefully', async () => {
      const testInfo = createMockTestInfo({ trace: 'on' });
      const service = new VisualTraceService(testInfo, 0);
      const errorTakeScreenshot = jest.fn(() => Promise.reject(new Error('Screenshot failed')));

      // Mock console.warn to verify it's called
      const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation();

      await service.captureScreenshot(errorTakeScreenshot, 'test-step');

      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Failed to capture screenshot')
      );
      expect(testInfo.attach).not.toHaveBeenCalled();

      consoleWarnSpy.mockRestore();
    });
  });

  describe('Screenshot limits', () => {
    test('should respect max screenshot limit', async () => {
      const testInfo = createMockTestInfo({ trace: 'on' });
      const service = new VisualTraceService(testInfo, 0, { maxScreenshots: 2 });

      // Capture first two screenshots
      await service.captureScreenshot(mockTakeScreenshot, 'step-1');
      await service.captureScreenshot(mockTakeScreenshot, 'step-2');

      // Third screenshot should be skipped
      await service.captureScreenshot(mockTakeScreenshot, 'step-3');

      expect(mockTakeScreenshot).toHaveBeenCalledTimes(2);
      expect(service.getScreenshotCount()).toBe(2);
    });

    test('should track screenshot count correctly', async () => {
      const testInfo = createMockTestInfo({ trace: 'on' });
      const service = new VisualTraceService(testInfo, 0);

      expect(service.getScreenshotCount()).toBe(0);

      await service.captureScreenshot(mockTakeScreenshot, 'step-1');
      expect(service.getScreenshotCount()).toBe(1);

      await service.captureScreenshot(mockTakeScreenshot, 'step-2');
      expect(service.getScreenshotCount()).toBe(2);
    });
  });

  describe('Deduplication', () => {
    test('should skip duplicate screenshots when dedupe is enabled', async () => {
      const testInfo = createMockTestInfo({ trace: 'on' });
      const service = new VisualTraceService(testInfo, 0, { dedupe: true });

      // Same screenshot data
      const sameData = Buffer.from('same-screenshot');
      const sameTakeScreenshot = jest.fn(() => Promise.resolve(sameData));

      await service.captureScreenshot(sameTakeScreenshot, 'step-1');
      await service.captureScreenshot(sameTakeScreenshot, 'step-2');

      expect(sameTakeScreenshot).toHaveBeenCalledTimes(2);
      expect(testInfo.attach).toHaveBeenCalledTimes(1); // Only attached once
    });

    test('should capture all screenshots when dedupe is disabled', async () => {
      const testInfo = createMockTestInfo({ trace: 'on' });
      const service = new VisualTraceService(testInfo, 0, { dedupe: false });

      // Same screenshot data
      const sameData = Buffer.from('same-screenshot');
      const sameTakeScreenshot = jest.fn(() => Promise.resolve(sameData));

      await service.captureScreenshot(sameTakeScreenshot, 'step-1');
      await service.captureScreenshot(sameTakeScreenshot, 'step-2');

      expect(sameTakeScreenshot).toHaveBeenCalledTimes(2);
      expect(testInfo.attach).toHaveBeenCalledTimes(2); // Attached both times
    });
  });

  describe('State management', () => {
    test('should maintain separate state for different test attempts', async () => {
      const testInfo = createMockTestInfo({ testId: 'test-1', trace: 'on' });

      // First attempt
      const service1 = new VisualTraceService(testInfo, 0);
      await service1.captureScreenshot(mockTakeScreenshot, 'step-1');
      expect(service1.getScreenshotCount()).toBe(1);

      // Second attempt (retry)
      const service2 = new VisualTraceService(testInfo, 1);
      expect(service2.getScreenshotCount()).toBe(0); // Should start fresh
      await service2.captureScreenshot(mockTakeScreenshot, 'step-1');
      expect(service2.getScreenshotCount()).toBe(1);

      // First attempt state should be preserved
      expect(service1.getScreenshotCount()).toBe(1);
    });

    test('should reset state when resetState is called', () => {
      const testInfo = createMockTestInfo({ testId: 'test-1', trace: 'on' });
      const service = new VisualTraceService(testInfo, 0);

      service['getState']().screenshotCount = 5;
      expect(service.getScreenshotCount()).toBe(5);

      service.resetState();
      expect(service.getScreenshotCount()).toBe(0);
    });
  });

  describe('Singleton management', () => {
    test('should initialize and get service instance', () => {
      const testInfo = createMockTestInfo({ testId: 'test-1' });

      const service = initializeVisualTrace(testInfo, 0);
      expect(service).toBeInstanceOf(VisualTraceService);

      const retrievedService = getVisualTraceService();
      expect(retrievedService).toBe(service);
    });

    test('should clear service instance', () => {
      const testInfo = createMockTestInfo({ testId: 'test-1' });

      initializeVisualTrace(testInfo, 0);
      expect(getVisualTraceService()).not.toBeNull();

      clearVisualTraceService();
      expect(getVisualTraceService()).toBeNull();
    });
  });

  describe('Configuration update', () => {
    test('should update configuration at runtime', () => {
      const testInfo = createMockTestInfo({ testId: 'test-1' });
      const service = new VisualTraceService(testInfo, 0);

      expect(service['config'].enableScreenshots).toBe('retain-on-failure');

      service.updateConfig({ enableScreenshots: 'on' });
      expect(service['config'].enableScreenshots).toBe('on');
    });

    test('should merge partial config updates', () => {
      const testInfo = createMockTestInfo({ testId: 'test-1' });
      const service = new VisualTraceService(testInfo, 0);

      service.updateConfig({ maxScreenshots: 100 });

      expect(service['config'].maxScreenshots).toBe(100);
      expect(service['config'].dedupe).toBe(true); // Should preserve other settings
    });
  });
});