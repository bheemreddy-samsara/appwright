import { afterEach, beforeAll, describe, expect, test, vi } from "vitest";
import fs from "fs/promises";
import os from "os";
import path from "path";

vi.mock("@ffmpeg-installer/ffmpeg", () => {
  return {
    default: { path: "/fake/ffmpeg" },
    __esModule: true,
  };
});

vi.mock("fluent-ffmpeg", () => {
  return {
    default: () => {
      const handlers: Record<string, (() => void) | undefined> = {};
      const chain = {
        setFfmpegPath: () => chain,
        setStartTime: () => chain,
        setDuration: () => chain,
        output: () => chain,
        on: (event: string, cb: () => void) => {
          handlers[event] = cb;
          return chain;
        },
        run: () => {
          void Promise.resolve().then(() => handlers.end?.());
        },
      };
      return chain;
    },
    __esModule: true,
  };
});

let mockBasePath = "";

const downloadVideoMock = vi.fn<
  (
    sessionId: string,
    outputDir: string,
    fileName: string,
  ) => Promise<{
    path: string;
    contentType: string;
  } | null>
>();

const getProviderClassMock = vi.fn(() => ({
  downloadVideo: downloadVideoMock,
}));

vi.mock("../providers", () => {
  return {
    getProviderClass: getProviderClassMock,
    __esModule: true,
  };
});

vi.mock("../utils", () => {
  return {
    basePath: () => mockBasePath,
    __esModule: true,
  };
});

vi.mock("../logger", () => {
  return {
    logger: {
      log: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    },
    __esModule: true,
  };
});

let VideoDownloader: any;

beforeAll(async () => {
  const reporterModule = await import("../reporter.js");
  VideoDownloader = reporterModule.default;
});

afterEach(async () => {
  const basePathToDelete = mockBasePath;
  downloadVideoMock.mockReset();
  mockBasePath = "";

  getProviderClassMock.mockClear();
  vi.useRealTimers();
  delete process.env.APPWRIGHT_DISABLE_VIDEO_DOWNLOAD;

  if (basePathToDelete) {
    await fs.rm(basePathToDelete, { recursive: true, force: true });
  }
});

describe("VideoDownloader", () => {
  test("downloads device videos with session-scoped filename", async () => {
    mockBasePath = await fs.mkdtemp(
      path.join(os.tmpdir(), "appwright-videos-"),
    );

    const sessionId = "session-123";
    const testId = "test-abc";

    downloadVideoMock.mockResolvedValueOnce({
      path: path.join(mockBasePath, `${sessionId}-${testId}.mp4`),
      contentType: "video/mp4",
    });

    const reporter = new VideoDownloader();
    const testCase = {
      id: testId,
      title: "example",
      annotations: [
        { type: "sessionId", description: sessionId },
        { type: "providerName", description: "browserstack" },
      ],
    } as any;
    const testResult = {
      workerIndex: 0,
      duration: 1,
      startTime: new Date(),
      attachments: [],
    } as any;

    reporter.onTestEnd(testCase, testResult);

    expect(getProviderClassMock).toHaveBeenCalledWith("browserstack");
    expect(downloadVideoMock).toHaveBeenCalledWith(
      sessionId,
      mockBasePath,
      `${sessionId}-${testId}`,
    );

    await reporter.onEnd();
    expect(testResult.attachments).toEqual([
      {
        path: path.join(mockBasePath, `${sessionId}-${testId}.mp4`),
        contentType: "video/mp4",
        name: "video",
      },
    ]);
  });

  test("scopes persistentDevice worker video base name by sessionId", async () => {
    vi.useFakeTimers();
    mockBasePath = await fs.mkdtemp(
      path.join(os.tmpdir(), "appwright-videos-"),
    );

    const workerIndex = 0;
    const sessionId = "session-xyz";
    const providerName = "browserstack";
    const workerVideoBaseName = `worker-${workerIndex}-${sessionId}-video`;

    const workerStart = new Date("2025-01-01T00:00:00.000Z");
    const testStart = new Date("2025-01-01T00:00:10.000Z");

    await fs.writeFile(
      path.join(mockBasePath, `worker-info-${workerIndex}.json`),
      JSON.stringify(
        {
          idx: workerIndex,
          sessionId,
          providerName,
          startTime: {
            beforeAppiumSession: workerStart.toISOString(),
            afterAppiumSession: workerStart.toISOString(),
          },
          endTime: new Date("2025-01-01T00:00:02.000Z").toISOString(),
          tests: [],
        },
        null,
        2,
      ),
    );

    const downloadedVideoPath = path.join(
      mockBasePath,
      `${workerVideoBaseName}.mp4`,
    );
    // Include a fake moov atom so validateMp4 passes
    await fs.writeFile(downloadedVideoPath, "fake-video-moov-marker");

    downloadVideoMock.mockResolvedValueOnce({
      path: downloadedVideoPath,
      contentType: "video/mp4",
    });

    const reporter = new VideoDownloader();
    const testCase = {
      id: "test-1",
      title: "persistent",
      annotations: [],
    } as any;
    const testResult = {
      workerIndex,
      duration: 1,
      startTime: testStart,
      retry: 1,
      attachments: [],
    } as any;

    reporter.onTestEnd(testCase, testResult);

    await vi.advanceTimersByTimeAsync(5000);
    await reporter.onEnd();

    expect(downloadVideoMock).toHaveBeenCalledWith(
      sessionId,
      mockBasePath,
      workerVideoBaseName,
    );

    expect(testResult.attachments).toMatchObject([
      {
        contentType: "video/mp4",
        name: "video",
        path: expect.stringContaining(`-retry-1.mp4`),
      },
    ]);
  });

  test("falls back to full video when downloaded MP4 is corrupt (missing moov atom)", async () => {
    vi.useFakeTimers();
    mockBasePath = await fs.mkdtemp(
      path.join(os.tmpdir(), "appwright-videos-"),
    );

    const workerIndex = 0;
    const sessionId = "session-corrupt";
    const providerName = "browserstack";
    const workerVideoBaseName = `worker-${workerIndex}-${sessionId}-video`;

    const workerStart = new Date("2025-01-01T00:00:00.000Z");
    const testStart = new Date("2025-01-01T00:00:10.000Z");

    await fs.writeFile(
      path.join(mockBasePath, `worker-info-${workerIndex}.json`),
      JSON.stringify(
        {
          idx: workerIndex,
          sessionId,
          providerName,
          startTime: {
            beforeAppiumSession: workerStart.toISOString(),
            afterAppiumSession: workerStart.toISOString(),
          },
          endTime: new Date("2025-01-01T00:00:20.000Z").toISOString(),
          tests: [],
        },
        null,
        2,
      ),
    );

    const downloadedVideoPath = path.join(
      mockBasePath,
      `${workerVideoBaseName}.mp4`,
    );
    // Write a file WITHOUT moov atom — simulates an incomplete BrowserStack download
    await fs.writeFile(downloadedVideoPath, "corrupt-partial-video-data");

    downloadVideoMock.mockResolvedValueOnce({
      path: downloadedVideoPath,
      contentType: "video/mp4",
    });

    const { logger } = await import("../logger.js");

    const reporter = new VideoDownloader();
    const testCase = {
      id: "test-corrupt",
      title: "corrupt video test",
      annotations: [] as { type: string; description?: string }[],
    } as any;
    const testResult = {
      workerIndex,
      duration: 5000,
      startTime: testStart,
      retry: 0,
      attachments: [],
    } as any;

    reporter.onTestEnd(testCase, testResult);

    await vi.advanceTimersByTimeAsync(5000);
    await reporter.onEnd();

    // Should fall back to attaching the full untrimmed video
    expect(testResult.attachments).toMatchObject([
      {
        contentType: "video/mp4",
        name: "video",
        path: downloadedVideoPath,
      },
    ]);

    // Should annotate the test with a videoError explaining the fallback
    const videoErrorAnnotation = testCase.annotations.find(
      (a: { type: string }) => a.type === "videoError",
    );
    expect(videoErrorAnnotation).toBeDefined();
    expect(videoErrorAnnotation!.description).toContain("Unable to trim video");

    // Should log the trim failure
    expect(logger.error).toHaveBeenCalledWith(
      "Failed to trim video:",
      expect.objectContaining({
        message: expect.stringContaining("missing moov atom"),
      }),
    );
  });

  test("skips BrowserStack video handling when video download is disabled", async () => {
    vi.useFakeTimers();
    process.env.APPWRIGHT_DISABLE_VIDEO_DOWNLOAD = "true";
    mockBasePath = await fs.mkdtemp(
      path.join(os.tmpdir(), "appwright-videos-"),
    );

    const workerIndex = 0;
    const sessionId = "session-xyz";
    const providerName = "browserstack";

    const workerStart = new Date("2025-01-01T00:00:00.000Z");

    await fs.writeFile(
      path.join(mockBasePath, `worker-info-${workerIndex}.json`),
      JSON.stringify(
        {
          idx: workerIndex,
          sessionId,
          providerName,
          startTime: {
            beforeAppiumSession: workerStart.toISOString(),
            afterAppiumSession: workerStart.toISOString(),
          },
          tests: [],
        },
        null,
        2,
      ),
    );

    const reporter = new VideoDownloader();
    const testCase = {
      id: "test-1",
      title: "persistent",
      annotations: [],
    } as any;
    const testResult = {
      workerIndex,
      duration: 1,
      startTime: new Date("2025-01-01T00:00:10.000Z"),
      attachments: [],
    } as any;

    reporter.onTestEnd(testCase, testResult);

    await vi.advanceTimersByTimeAsync(5000);
    await reporter.onEnd();

    expect(downloadVideoMock).not.toHaveBeenCalled();
    expect(testResult.attachments).toEqual([]);
  });

  test("skips video gracefully when worker has no session (e.g., skipped test)", async () => {
    vi.useFakeTimers();
    mockBasePath = await fs.mkdtemp(
      path.join(os.tmpdir(), "appwright-videos-"),
    );

    const workerIndex = 1;

    // Worker info exists but has no providerName or sessionId
    // (worker was assigned but test was skipped before session creation)
    await fs.writeFile(
      path.join(mockBasePath, `worker-info-${workerIndex}.json`),
      JSON.stringify(
        {
          idx: workerIndex,
          startTime: {
            beforeAppiumSession: new Date().toISOString(),
            afterAppiumSession: new Date().toISOString(),
          },
          tests: [],
        },
        null,
        2,
      ),
    );

    const { logger } = await import("../logger.js");
    // Clear any state from previous tests
    vi.mocked(logger.error).mockClear();
    vi.mocked(logger.log).mockClear();

    const reporter = new VideoDownloader();
    const testCase = {
      id: "test-skipped",
      title: "skipped test on worker without session",
      annotations: [] as { type: string; description?: string }[],
    } as any;
    const testResult = {
      workerIndex,
      duration: 100,
      startTime: new Date(),
      attachments: [],
    } as any;

    reporter.onTestEnd(testCase, testResult);

    await vi.advanceTimersByTimeAsync(5000);
    await reporter.onEnd();

    // Should not attempt to download any video
    expect(downloadVideoMock).not.toHaveBeenCalled();
    expect(testResult.attachments).toEqual([]);

    // Should NOT log an error (previously threw and was caught as error)
    expect(logger.error).not.toHaveBeenCalled();

    // Should log an informational skip message
    expect(logger.log).toHaveBeenCalledWith(
      expect.stringContaining("skipping video"),
    );
  });
});
