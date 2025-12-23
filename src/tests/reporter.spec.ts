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
    await fs.writeFile(downloadedVideoPath, "video-bytes");

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
});
